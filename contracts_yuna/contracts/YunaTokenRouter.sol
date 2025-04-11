// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./YunaDEX.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Add CreatorCoin interface with the methods we need
interface ICreatorCoin {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract YunaTokenRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Add withdrawal reason tracking
    enum WithdrawReason { ADMIN_OVERRIDE, MIGRATION, CONTRACT_ERROR }

    // ETH is represented by address(0)
    address public constant ETH_ADDRESS = address(0);
    YunaLiquidityManager public liquidityManager;
    YunaDEX public dex;
    mapping(address => bool) public listedTokens;
    ICreatorCoin public creatorTokenFactory;  // Use interface instead of concrete implementation
    bool public paused;
    uint256 public constant MIN_INITIAL_ETH = 0.01 * 1e18;  // 0.01 ETH minimum
    uint256 public constant MAX_INITIAL_ETH = 1000 * 1e18;  // 1000 ETH maximum

    // Add configurable slippage parameter (500 = 5% as default)
    uint256 public defaultMaxSlippage = 500;

    // Add mapping to track tokens in price discovery
    mapping(address => bool) public inPriceDiscovery;

    // Add error messages as constants for consistency
    string private constant ERR_ZERO_ETH = "Initial liquidity cannot be zero";
    string private constant ERR_ZERO_SUBSCRIBERS = "Initial subscribers cannot be zero";
    string private constant ERR_INSUFFICIENT_ETH = "Insufficient ETH balance";
    string private constant ERR_INVALID_ETH_AMOUNT = "Invalid ETH amount";
    string private constant ERR_INVALID_CREATOR = "Invalid creator token";
    string private constant ERR_INVALID_SLIPPAGE = "Invalid slippage value";

    // Approval tracking is still needed for creator tokens
    mapping(address => bool) public hasOpenApproval;
    uint256 public constant APPROVAL_TIMEOUT = 1 hours;
    uint256 public lastApprovalTimestamp;

    // Add pause state tracking
    uint256 public lastPauseChange;

    // Enable contract to receive ETH
    receive() external payable {}
    fallback() external payable {}

    event TokenListed(address indexed creatorToken);
    event TokenAutoListed(address indexed token, uint256 initialLiquidity);
    event ApprovalGranted(address indexed token, uint256 amount, uint256 timestamp);
    event ApprovalRevoked(address indexed token, uint256 timestamp);
    event PauseStateChanged(
        bool indexed isPaused,
        uint256 timestamp,
        address indexed actor
    );
    event TokenSwappedForETH(
        address indexed token,
        uint256 amountIn,
        uint256 amountOut
    );
    event ETHSwappedForToken(
        address indexed token,
        uint256 amountIn,
        uint256 amountOut
    );
    event PriceDiscoveryFailed(address indexed token, uint256 timestamp);
    event PriceDiscoveryCompleted(address indexed token, uint256 timestamp);
    event EmergencyWithdraw(
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 timestamp,
        WithdrawReason reason
    );
    event SlippageUpdated(uint256 oldSlippage, uint256 newSlippage);

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor(
        address _liquidityManager,
        address _dex,
        address _creatorTokenFactory
    ) Ownable(msg.sender) {
        liquidityManager = YunaLiquidityManager(payable(_liquidityManager));
        dex = YunaDEX(payable(_dex));
        creatorTokenFactory = ICreatorCoin(_creatorTokenFactory);
    }

    /**
     * @dev Lists a new creator token in the DEX
     */
    function listNewCreatorToken(address creatorToken) public onlyOwner {
        require(creatorToken != address(0), "Invalid token address");
        require(!listedTokens[creatorToken], "Token already listed");
        
        // Debugging: Log total supply before listing
        uint256 totalSupply = IERC20(creatorToken).totalSupply();
        require(totalSupply > 0, "Token has zero supply");

        require(!inPriceDiscovery[creatorToken], "Token still in price discovery");

        // Debugging: Check if the pool is tracked
        bool isTracked = liquidityManager.isTrackedPool(creatorToken);
        require(isTracked, "Liquidity pool not tracked!");

        // Debugging: Log tracking confirmation
        emit TokenListed(creatorToken);

        listedTokens[creatorToken] = true;
    }

    /**
     * @dev Updates default max slippage value (in basis points, 100 = 1%)
     */
    function updateDefaultMaxSlippage(uint256 newSlippage) external onlyOwner {
        require(newSlippage > 0 && newSlippage <= 5000, ERR_INVALID_SLIPPAGE); // Max 50%
        uint256 oldSlippage = defaultMaxSlippage;
        defaultMaxSlippage = newSlippage;
        emit SlippageUpdated(oldSlippage, newSlippage);
    }

    /**
     * @dev Updates AI rebalance through liquidity manager
     */
    function updateAIRebalance(
        address creatorToken, 
        uint256 newReserveETH
    ) external payable onlyOwner {
        // Direct call to liquidity manager with ETH
        liquidityManager.addLiquidity{value: newReserveETH}(creatorToken, 0);
    }

    /**
     * @dev Toggles pause state with simplified logic
     */
    function togglePause() external onlyOwner {
        paused = !paused;
        lastPauseChange = block.timestamp;
        
        emit PauseStateChanged(
            paused,
            block.timestamp,
            msg.sender
        );
    }

    /**
     * @dev View function to get pause state details
     */
    function getPauseState() external view returns (
        bool isPaused,
        uint256 lastChange,
        uint256 duration
    ) {
        return (
            paused,
            lastPauseChange,
            lastPauseChange > 0 ? block.timestamp - lastPauseChange : 0
        );
    }

    /**
     * @dev Safely manages token approvals with optimized approval handling
     * Only used for creator tokens, not ETH
     */
    function manageApproval(address token, uint256 amount) internal {
        if (token == ETH_ADDRESS) return;

        uint256 currentAllowance = IERC20(token).allowance(address(this), address(liquidityManager));

        if (hasOpenApproval[token] && currentAllowance > 0) {
            IERC20(token).approve(address(liquidityManager), 0);  // Use regular approve for resetting
            hasOpenApproval[token] = false;
            emit ApprovalRevoked(token, block.timestamp);
        }

        if (currentAllowance < amount) {
            if (currentAllowance > 0) {
                IERC20(token).approve(address(liquidityManager), 0);  // Use regular approve for resetting
            }
            IERC20(token).approve(address(liquidityManager), amount);  // Use regular approve for setting
            hasOpenApproval[token] = true;
            lastApprovalTimestamp = block.timestamp;
            emit ApprovalGranted(token, amount, block.timestamp);
        }
    }

    /**
     * @dev Auto-revokes expired approvals for creator tokens
     */
    function checkAndRevokeExpiredApprovals(address token) internal {
        // Skip if it's ETH
        if (token == ETH_ADDRESS) return;

        if (hasOpenApproval[token] && 
            block.timestamp > lastApprovalTimestamp + APPROVAL_TIMEOUT) {
            revokeApproval(token);
        }
    }

    /**
     * @dev Explicit approval revocation with optimization
     */
    function revokeApproval(address token) public onlyOwner {
        // Skip if it's ETH
        if (token == ETH_ADDRESS) return;
        
        // Check current allowance first
        uint256 currentAllowance = IERC20(token).allowance(
            address(this), 
            address(liquidityManager)
        );
        
        // Only revoke if there's an allowance
        if (currentAllowance > 0 && hasOpenApproval[token]) {
            IERC20(token).approve(address(liquidityManager), 0);
            hasOpenApproval[token] = false;
            emit ApprovalRevoked(token, block.timestamp);
        }
    }

    /**
     * @dev Called when a new token is minted
     */
    function onTokenMinted(
        address token, 
        uint256 subscriberCount
    ) external payable whenNotPaused {
        // Basic checks
        require(msg.sender == address(creatorTokenFactory), "Unauthorized");
        require(!inPriceDiscovery[token], "Token already in discovery");
        require(subscriberCount > 0, ERR_ZERO_SUBSCRIBERS);
        
        // Calculate initial liquidity
        uint256 initialLiquidity = calculateInitialLiquidity(subscriberCount);
        require(initialLiquidity > 0, ERR_ZERO_ETH);
        
        // Ensure enough ETH was sent
        require(msg.value >= initialLiquidity, "Insufficient ETH sent");
        
        // Mark token as in price discovery before external calls
        inPriceDiscovery[token] = true;

        // Direct call to liquidityManager with ETH
        liquidityManager.startPriceDiscovery{value: initialLiquidity}(token, subscriberCount);
        
        // List token (but don't add liquidity yet)
        listNewCreatorToken(token);
        
        // Refund excess ETH if any
        uint256 excessETH = msg.value - initialLiquidity;
        if (excessETH > 0) {
            _transferETH(payable(msg.sender), excessETH);
        }
        
        emit TokenAutoListed(token, initialLiquidity);
    }
    
    /**
     * @dev Updates engagement metrics during price discovery
     */
    function updateEngagementMetrics(
        address token,
        uint256 currentSubscribers
    ) external onlyOwner {
        require(inPriceDiscovery[token], "Token not in discovery");
        liquidityManager.recordEngagementSnapshot(token, currentSubscribers);
    }
    
    /**
     * @dev Completes price discovery with improved validation and re-entrancy protection
     */
    function completePriceDiscovery(
        address token
    ) external onlyOwner nonReentrant {
        require(inPriceDiscovery[token], "Token not in discovery");

        // Check contract ETH balance
        uint256 currentLiquidity = address(this).balance;
        require(currentLiquidity > 0, ERR_ZERO_ETH);

        uint256 initialReserve;
        (, initialReserve) = liquidityManager.getReserves(token);

        // Update state first to prevent re-entrancy
        inPriceDiscovery[token] = false;

        // External interactions after state changes (CEI pattern)
        liquidityManager.completePriceDiscovery(token);

        (, uint256 ethReserve) = liquidityManager.getReserves(token);
        require(ethReserve > initialReserve, "Liquidity not added");

        emit PriceDiscoveryCompleted(token, block.timestamp);
    }

    /**
     * @dev Calculates initial liquidity based on subscriber count
     */
    function calculateInitialLiquidity(
        uint256 subscriberCount
    ) public pure returns (uint256) {
        require(subscriberCount > 0, ERR_ZERO_SUBSCRIBERS);
        // Adjusted for ETH values (smaller amount per subscriber)
        return subscriberCount * 1e16; // 0.01 ETH per subscriber
    }

    /**
     * @dev Swaps ETH for creator tokens
     */
    function swapETHForToken(
        address token,
        uint256 minAmountOut
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        require(token != address(0), ERR_INVALID_CREATOR);
        require(msg.value > 0, ERR_INVALID_ETH_AMOUNT);
        require(!inPriceDiscovery[token], "Token in price discovery");
        require(listedTokens[token], "Token not listed");

        // Execute swap through DEX with ETH
        uint256 amountOut = dex.swapETHForCreatorToken{value: msg.value}(
            token,
            minAmountOut,
            defaultMaxSlippage
        );

        require(amountOut >= minAmountOut, "Slippage too high");

        // Emit event before transfer (CEI pattern)
        emit ETHSwappedForToken(token, msg.value, amountOut);

        return amountOut;
    }

    /**
     * @dev Swaps creator tokens for ETH
     */
    function swapTokenForETH(
        address token,
        uint256 tokenAmount,
        uint256 minETHOut
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(token != address(0), ERR_INVALID_CREATOR);
        require(tokenAmount > 0, "Token amount must be greater than 0");
        require(!inPriceDiscovery[token], "Token in price discovery");
        require(listedTokens[token], "Token not listed");

        // Transfer tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        
        // Use direct approval to DEX instead of using manageApproval
        // First clear any existing allowance
        uint256 currentAllowance = IERC20(token).allowance(address(this), address(dex));
        if (currentAllowance > 0) {
            IERC20(token).approve(address(dex), 0);
        }
        
        // Set exact approval for this transaction
        IERC20(token).approve(address(dex), tokenAmount);

        // Execute swap - DEX will handle ETH transfer directly to user
        dex.swapCreatorTokenForETH(
            token,
            tokenAmount,
            minETHOut,
            defaultMaxSlippage
        );
        
        // Emit event for swap tracking
        emit TokenSwappedForETH(token, tokenAmount, minETHOut);
        
        return minETHOut;
    }

    /**
     * @dev Emergency function to withdraw ETH with reason tracking
     * @param to Address to send ETH to
     * @param amount Amount of ETH to withdraw
     * @param reason Reason for emergency withdrawal
     */
    function emergencyWithdrawETH(
        address payable to, 
        uint256 amount,
        WithdrawReason reason
    ) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        require(!paused, "Contract is paused");

        uint256 balance = address(this).balance;
        require(amount <= balance, ERR_INSUFFICIENT_ETH);
        
        // Emit event before transfer (CEI pattern)
        emit EmergencyWithdraw(ETH_ADDRESS, to, amount, block.timestamp, reason);
        
        // Transfer ETH using the helper function
        _transferETH(to, amount);
    }
    
    /**
     * @dev Emergency function to withdraw any ERC20 tokens that might be stuck
     */
    function emergencyWithdrawToken(
        address token,
        address to,
        uint256 amount,
        WithdrawReason reason
    ) external onlyOwner nonReentrant {
        require(token != address(0), "Invalid token address");
        require(to != address(0), "Invalid recipient address");
        require(!paused, "Contract is paused");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(amount <= balance, "Insufficient token balance");
        
        // Emit event before transfer
        emit EmergencyWithdraw(token, to, amount, block.timestamp, reason);
        
        // Transfer tokens
        IERC20(token).safeTransfer(to, amount);
    }
    
    /**
     * @dev Helper to transfer ETH to an address
     */
    function _transferETH(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount, gas: 30000}("");
        require(success, "ETH transfer failed");
    }
}
