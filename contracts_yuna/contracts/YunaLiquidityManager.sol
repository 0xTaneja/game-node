// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract YunaLiquidityManager is Ownable, AccessControl, ReentrancyGuard, ERC20 {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public creatorTokenReserves;
    mapping(address => uint256) public ethReserves;
    mapping(address => uint256) public collectedFees;

    uint256 public constant REBALANCE_INTERVAL = 1 hours; // Changed from 2 minutes
    uint256 public lastRebalanceTimestamp;
    uint256 public constant ENGAGEMENT_THRESHOLD = 1000; // 10% in basis points

    struct EngagementMetrics {
        uint256 lastSubscriberCount;
        uint256 smoothedSubscriberCount;
        uint256 lastUpdateTime;
        uint256 updateCount;
    }
    
    mapping(address => EngagementMetrics) public tokenEngagement;

    // Add constant for minimum liquidity
    uint256 public constant MIN_LIQUIDITY = 10 * 1e18; // 10 ETH minimum liquidity

    // Add event declaration for ReservesUpdated
    event ReservesUpdated(
        address indexed token,
        uint256 creatorReserve,
        uint256 ethReserve
    );

    // Add new event
    event FeesRedeployed(
        address indexed token,
        uint256 amount,
        address indexed targetPool
    );

    // Add minimum fee threshold for redeployment
    uint256 public constant MIN_FEES_FOR_REDEPLOY = 5 * 1e18; // 5 ETH minimum fees

    // Add new struct for token price discovery
    struct PriceDiscoveryData {
        uint256 initialSubscribers;
        uint256 currentSubscribers;
        uint256 observationStartTime;
        bool isInDiscovery;
        uint256[] engagementSnapshots;
    }
    
    // Add mapping for price discovery
    mapping(address => PriceDiscoveryData) public priceDiscovery;
    
    // Constants for price discovery
    uint256 public DISCOVERY_PERIOD;
    uint256 public SNAPSHOT_INTERVAL;
    uint256 public constant MAX_SNAPSHOTS = 6; // 2 minutes / 20 seconds
    
    // Events
    event PriceDiscoveryStarted(address indexed token, uint256 initialSubscribers);
    event PriceDiscoveryCompleted(
        address indexed token, 
        uint256 initialEthPrice,
        uint256 initialLiquidity
    );
    event EngagementSnapshotTaken(
        address indexed token,
        uint256 subscribers,
        uint256 timestamp
    );

    // Add array to track all pools
    address[] public trackedPools;
    mapping(address => bool) public isTrackedPool;

    // Add event for pool tracking
    event PoolTracked(address indexed pool);
    event PoolUntracked(address indexed pool);

    // Add constant for minimum token price
    uint256 public constant MIN_TOKEN_PRICE = 0.1e18; // 0.1 ETH minimum price

    // Add price protection constants
    uint256 public constant MAX_PRICE_MULTIPLIER = 3; // 3x cap on price increase
    uint256 public constant BASE_PRICE = 1e18; // 1 ETH token base price

    // Add new event for auto fee redeployment
    event AutoFeesRedeployed(
        address indexed token,
        uint256 amount,
        address indexed targetPool,
        uint256 ethAmount,
        uint256 timestamp
    );

    // Add constants for smoothing
    uint256 private constant WEIGHT_PREVIOUS = 80;
    uint256 private constant WEIGHT_NEW = 20;
    uint256 private constant REBALANCE_THRESHOLD = 110; // 10% above smoothed value
    uint256 private constant MIN_UPDATES_BEFORE_REBALANCE = 3;

    // Add event for smoothed metrics
    event EngagementSmoothed(
        address indexed token,
        uint256 rawCount,
        uint256 smoothedCount,
        uint256 timestamp
    );

    // Add trading activity tracking
    struct PoolActivity {
        uint256 lastTradeTimestamp;
        uint256 tradingVolume24h;
        uint256 lastVolumeUpdateTime;
    }
    
    mapping(address => PoolActivity) public poolActivity;
    
    // Add constants for activity checks
    uint256 public constant ACTIVITY_THRESHOLD = 7 days;
    uint256 public constant MIN_24H_VOLUME = 10 * 1e18; // 10 ETH minimum volume
    
    // Add event for activity updates
    event PoolActivityUpdated(
        address indexed pool,
        uint256 volume24h
    );

    // Add error messages as constants
    string private constant ERR_NO_FEES = "No fees available to redeploy";
    string private constant ERR_BELOW_MIN = "Below minimum fee threshold";
    string private constant ERR_INSUFFICIENT_ETH = "Insufficient ETH balance";
    string private constant ERR_BELOW_MIN_ETH = "Below minimum ETH liquidity";

    // Add DEX reference
    address public dex;
    
    // Add role for DEX
    bytes32 public constant DEX_ROLE = keccak256("DEX_ROLE");
    bytes32 public constant BACKUP_DEX_ROLE = keccak256("BACKUP_DEX_ROLE");

    // Add state variables for tracking most needy pool
    struct PoolNeedInfo {
        address pool;
        uint256 score;
        uint256 lastUpdateTime;
    }

    PoolNeedInfo public mostNeededPool;
    uint256 public constant POOL_NEED_UPDATE_INTERVAL = 1 hours;

    // Add event for pool need updates
    event PoolNeedUpdated(
        address indexed pool,
        uint256 score,
        uint256 timestamp
    );

    // Add constant for maximum liquidity per pool
    uint256 public maxLiquidityPerPool = 10_000 * 1e18; // Initial value: 10,000 ETH per pool

    // Add constant for minimum deployment amount
    uint256 public constant MIN_DEPLOYMENT_AMOUNT = 1 * 1e18; // 1 ETH minimum deployment

    // Add event for max liquidity updates
    event MaxLiquidityUpdated(
        uint256 oldMax,
        uint256 newMax
    );

    // Consolidate debug events into focused categories
    event LiquidityOperation(
        string operation,  // "add", "remove", "rebalance"
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event PoolOperation(
        string operation,  // "add", "remove", "update"
        address indexed pool,
        uint256 score,
        uint256 timestamp
    );

    event FeeOperation(
        string operation,  // "collect", "withdraw", "redeploy"
        address indexed token,
        uint256 amount,
        address indexed target
    );

    // Replace multiple debug events with focused metrics
    event PoolMetrics(
        address indexed pool,
        uint256 liquidity,
        uint256 volume24h,
        uint256 score
    );

    event RebalanceMetrics(
        address indexed token,
        uint256 oldLiquidity,
        uint256 newLiquidity,
        string reason
    );

    // Add constant for absolute maximum liquidity
    uint256 public constant ABSOLUTE_MAX_LIQUIDITY = 100000 * 1e18; // 100,000 ETH maximum

    // Add constant for safety buffer
    uint256 private constant LIQUIDITY_SAFETY_BUFFER = 50; // 50% buffer

    // Add struct for historical volume data
    struct VolumeHistory {
        uint256 lastRecordedVolume;
        uint256 timestamp;
    }

    // Add mapping for historical data
    mapping(address => VolumeHistory[]) public volumeHistory;
    uint256 public constant MAX_HISTORY_ENTRIES = 30; // Keep 30 days of history

    // Add mapping for whitelisted withdrawal addresses
    mapping(address => bool) public whitelistedWithdrawAddresses;

    // Add events for whitelist management
    event WithdrawAddressWhitelisted(address indexed account, uint256 timestamp);
    event WithdrawAddressRemoved(address indexed account, uint256 timestamp);

    // Add struct for pool priority queue
    struct PoolScore {
        address pool;
        uint256 score;
        uint256 lastUpdateTime;
    }

    // Add priority queue for pool tracking
    PoolScore[] private poolScores;
    mapping(address => uint256) private poolScoreIndex;
    uint256 private constant BATCH_SIZE = 10;
    uint256 private lastProcessedIndex;

    // Add constant for minimum change threshold
    uint256 private constant REBALANCE_MIN_CHANGE = 10; // 10% minimum change

    // Add struct for sorted pool tracking
    struct SortedPool {
        address pool;
        uint256 score;
        uint256 lastUpdateTime;
        uint256 nextIndex;  // For linked list implementation
        uint256 prevIndex;  // For linked list implementation
    }

    // Add sorted pool tracking
    mapping(uint256 => SortedPool) public sortedPools;
    uint256 public topPoolIndex;
    uint256 public poolCount;

    // Add native ETH receipt capability
    receive() external payable {}
    fallback() external payable {}

    constructor() Ownable(msg.sender) ERC20("Base Liquidity Token", "BLT") {
        // Setup initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        
        // Initialize price discovery settings with shorter intervals for Base
        DISCOVERY_PERIOD = 2 days;  // Adjusted for Base network
        SNAPSHOT_INTERVAL = 1 hours;  // Adjusted for Base network
        
        // Set initial max liquidity per pool
        maxLiquidityPerPool = 10000 * 1e18; // 10,000 ETH tokens
    }

    event LiquidityAdded(
        address indexed creatorToken, 
        uint256 amountCreator, 
        uint256 amountEth,
        uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed creatorToken, 
        uint256 amountCreator, 
        uint256 amountEth
    );
    event FeesCollected(address indexed token, uint256 amount);
    event LiquidityRebalanced(
        address indexed token, 
        uint256 newReserveEth
    );
    event FeesWithdrawn(address indexed token, uint256 amount);

    /**
     * @dev Adds a new pool to tracking
     * @param pool The pool address to track
     */
    function addPoolToTracking(address pool) external onlyOwner {
        require(pool != address(0), "Invalid pool address");
        require(!isTrackedPool[pool], "Pool already tracked");
        
        // Verify price discovery is complete
        require(
            !priceDiscovery[pool].isInDiscovery,
            "Price discovery not complete"
        );

        isTrackedPool[pool] = true;
        trackedPools.push(pool);
        
        emit PoolTracked(pool);
    }

    /**
     * @dev Checks if a token is ETH (represented by address(0))
     * @param token The token address to check
     * @return bool True if token is ETH, false otherwise
     */
    function isETH(address token) public pure returns (bool) {
        return token == address(0);
    }

    function _updateReserves(
        address token,
        uint256 creatorReserve,
        uint256 ethReserve
    ) internal {
        creatorTokenReserves[token] = creatorReserve;
        ethReserves[token] = ethReserve;
        // Add event declaration at top of contract
        emit ReservesUpdated(token, creatorReserve, ethReserve);
    }

    /**
     * @dev Calculates the amount of liquidity tokens to mint
     * @param amountCreator Amount of creator tokens being added
     * @param amountEth Amount of ETH being added
     * @param creatorReserve Current creator token reserve
     * @param ethReserve Current ETH reserve
     * @return liquidity Amount of LP tokens to mint
     */
    function calculateLiquidity(
        uint256 amountCreator,
        uint256 amountEth,
        uint256 creatorReserve,
        uint256 ethReserve
    ) internal view returns (uint256 liquidity) {
        if (creatorReserve == 0 && ethReserve == 0) {
            // Initial liquidity provision
            liquidity = Math.sqrt(amountCreator * amountEth);
        } else {
            // Subsequent liquidity provision
            uint256 liquidityCreator = (amountCreator * totalSupply()) / creatorReserve;
            uint256 liquidityEth = (amountEth * totalSupply()) / ethReserve;
            liquidity = Math.min(liquidityCreator, liquidityEth);
        }
        return liquidity;
    }

    /**
     * @dev Adds liquidity to the pool
     * @param creatorToken The creator token address
     * @param amountCreator Amount of creator tokens to add
     * @return liquidity Amount of LP tokens minted
     */
    function addLiquidity(
        address creatorToken,
        uint256 amountCreator
    ) external payable nonReentrant returns (uint256 liquidity) {
        uint256 amountEth = msg.value;
        require(creatorToken != address(0), "Invalid creator token");
        require(amountCreator > 0 && amountEth > 0, "Zero amounts not allowed");
        require(amountEth >= MIN_LIQUIDITY, "ETH amount below minimum liquidity");
        require(isTrackedPool[creatorToken], "Pool not tracked");

        // Get current reserves
        (uint256 currentCreatorReserve, uint256 currentEthReserve) = getReserves(creatorToken);

        // Check max liquidity limit
        uint256 remainingLiquidity = maxLiquidityPerPool - currentEthReserve;
        if (amountEth > remainingLiquidity) {
            emit LiquidityOperation("liquidity_adjustment", creatorToken, amountEth, remainingLiquidity);
            amountEth = remainingLiquidity;
            amountCreator = remainingLiquidity; // Maintain 1:1 ratio
        }

        require(amountEth <= maxLiquidityPerPool, "ETH amount above maximum liquidity");
        require(currentEthReserve + amountEth <= maxLiquidityPerPool, "Total liquidity would exceed maximum");

        // Transfer tokens to this contract
        IERC20(creatorToken).safeTransferFrom(msg.sender, address(this), amountCreator);
        // ETH is already sent with the transaction

        // Calculate liquidity tokens to mint
        liquidity = calculateLiquidity(amountCreator, amountEth, currentCreatorReserve, currentEthReserve);
        require(liquidity > 0, "Insufficient liquidity minted");

        // Update reserves and mint LP tokens
        _updateReserves(creatorToken, currentCreatorReserve + amountCreator, currentEthReserve + amountEth);
        _mint(msg.sender, liquidity);

        emit LiquidityAdded(creatorToken, amountCreator, amountEth, liquidity);
        return liquidity;
    }

    /**
     * @dev Gets the current reserves for a creator token pool
     * @param creatorToken The creator token address
     * @return creatorReserve Amount of creator tokens in reserve
     * @return ethReserve Amount of ETH in reserve
     */
    function getReserves(
        address creatorToken
    ) public view returns (
        uint256 creatorReserve,
        uint256 ethReserve
    ) {
        require(creatorToken != address(0), "Invalid creator token");
        return (creatorTokenReserves[creatorToken], ethReserves[creatorToken]);
    }

    /**
     * @dev Removes liquidity from a pool
     */
    function removeLiquidity(
        address creatorToken, 
        uint256 amountCreator, 
        uint256 amountEth
    ) external onlyOwner {
        // Calculate new reserves first
        uint256 newCreatorReserve = creatorTokenReserves[creatorToken] - amountCreator;
        uint256 newEthReserve = ethReserves[creatorToken] - amountEth;

        // Validate minimum reserves
        require(newCreatorReserve >= MIN_LIQUIDITY, "Creator reserve below minimum");
        require(newEthReserve >= MIN_LIQUIDITY, "ETH reserve below minimum");

        // Replace multiple DebugLog emissions with single focused event
        emit LiquidityOperation(
            "remove",
            creatorToken,
            amountCreator,
            block.timestamp
        );

        // Log current reserves
        emit PoolMetrics(creatorToken, creatorTokenReserves[creatorToken], ethReserves[creatorToken], maxLiquidityPerPool);

        // Update reserves
        creatorTokenReserves[creatorToken] -= amountCreator;
        ethReserves[creatorToken] -= amountEth;

        // Transfer tokens back to caller
        IERC20(creatorToken).safeTransfer(msg.sender, amountCreator);
        transferETH(payable(msg.sender), amountEth);

        // Final success log
        emit LiquidityOperation("completed", creatorToken, amountCreator, block.timestamp);
        emit LiquidityRemoved(creatorToken, amountCreator, amountEth);
        
        // Log final reserves
        emit PoolMetrics(creatorToken, creatorTokenReserves[creatorToken], ethReserves[creatorToken], maxLiquidityPerPool);
    }

    function collectFees(address token, uint256 amount) external onlyOwner {
        collectedFees[token] += amount;
        emit FeeOperation("collect", token, amount, address(0));
    }

    /**
     * @dev View function to check if a pool has valid liquidity
     * @param creatorToken The creator token to check
     * @return bool True if pool has valid liquidity
     */
    function hasValidLiquidity(
        address creatorToken
    ) public view returns (bool) {
        (uint256 creator, uint256 eth) = this.getReserves(creatorToken);
        return creator >= MIN_LIQUIDITY && 
               creator <= maxLiquidityPerPool &&
               eth >= MIN_LIQUIDITY &&
               eth <= maxLiquidityPerPool;
    }

    /**
     * @dev Withdraws collected fees with whitelist protection
     */
    function withdrawFees(
        address token,
        uint256 amount
    ) external onlyOwner {
        // Replace multiple DebugLog emissions with single focused event
        emit FeeOperation(
            "withdraw",
            token,
            amount,
            address(0)
        );

        // Check whitelist
        require(whitelistedWithdrawAddresses[msg.sender], "Not authorized for withdrawal");

        // Validate withdrawal
        require(amount > 0, "Amount must be greater than 0");
        require(collectedFees[token] >= amount, "Insufficient collected fees");

        // Log pre-withdrawal state
        emit PoolMetrics(token, IERC20(token).balanceOf(address(this)), amount, 0);

        // Update state before transfer
        collectedFees[token] -= amount;

        if (token == address(0)) {
            // Transfer ETH
            require(address(this).balance >= amount, "Insufficient ETH balance");
            transferETH(payable(msg.sender), amount);
        } else {
            // Transfer ERC20 tokens
            IERC20 tokenContract = IERC20(token);
            
            // Check contract balance
            uint256 contractBalance = tokenContract.balanceOf(address(this));
            require(contractBalance >= amount, "Insufficient contract balance");

            // Perform transfer directly without bool check
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        // Log withdrawal
        emit FeeOperation("completed", token, amount, msg.sender);
    }

    /**
     * @dev Calculates smoothed engagement using weighted moving average
     */
    function calculateSmoothedEngagement(
        uint256 previous,
        uint256 current
    ) internal pure returns (uint256) {
        return (
            (previous * WEIGHT_PREVIOUS / 100) + 
            (current * WEIGHT_NEW / 100)
        );
    }

    /**
     * @dev Updates engagement metrics with optimized rebalancing
     */
    function updateEngagementMetrics(
        address token, 
        uint256 newSubscriberCount
    ) external onlyOwner {
        // Cache storage pointer
        EngagementMetrics storage metrics = tokenEngagement[token];
        
        // Cache current values to avoid multiple storage reads
        uint256 currentSmoothed = metrics.smoothedSubscriberCount;
        uint256 currentUpdateCount = metrics.updateCount;
        
        emit LiquidityOperation(
            "engagement_update_started",
            token,
            newSubscriberCount,
            block.timestamp
        );
        
        // Initialize if first update
        if (currentUpdateCount == 0) {
            metrics.lastSubscriberCount = newSubscriberCount;
            metrics.smoothedSubscriberCount = newSubscriberCount;
            metrics.updateCount = 1;
            
            emit PoolOperation(
                "engagement_initialized", 
                token, 
                newSubscriberCount, 
                block.timestamp
            );
            return;
        }

        // Calculate smoothed value
        uint256 newSmoothedCount = calculateSmoothedEngagement(
            currentSmoothed,
            newSubscriberCount
        );

        // Calculate percentage change
        uint256 percentChange;
        if (newSmoothedCount > currentSmoothed) {
            percentChange = ((newSmoothedCount - currentSmoothed) * 100) / currentSmoothed;
        } else {
            percentChange = ((currentSmoothed - newSmoothedCount) * 100) / currentSmoothed;
        }

        // Update metrics (single storage write for each value)
        metrics.lastSubscriberCount = newSubscriberCount;
        metrics.smoothedSubscriberCount = newSmoothedCount;
        metrics.lastUpdateTime = block.timestamp;
        metrics.updateCount = currentUpdateCount + 1;

        emit EngagementSmoothed(
            token,
            newSubscriberCount,
            newSmoothedCount,
            block.timestamp
        );

        // Check if rebalance needed
        if (currentUpdateCount >= MIN_UPDATES_BEFORE_REBALANCE) {
            if (percentChange >= REBALANCE_MIN_CHANGE) {
                uint256 rebalanceThreshold = (newSmoothedCount * REBALANCE_THRESHOLD) / 100;
            
            if (newSubscriberCount > rebalanceThreshold) {
                    _rebalanceLiquidity(token, newSmoothedCount);
                }
            } else {
                emit RebalanceSkipped(
                    token,
                    newSmoothedCount,
                    "Change below minimum threshold"
                );
            }
        }
    }

    /**
     * @dev View function to get smoothed engagement metrics
     */
    function getSmoothedMetrics(
        address token
    ) external view returns (
        uint256 lastCount,
        uint256 smoothedCount,
        uint256 updateCount,
        bool eligibleForRebalance
    ) {
        EngagementMetrics storage metrics = tokenEngagement[token];
        return (
            metrics.lastSubscriberCount,
            metrics.smoothedSubscriberCount,
            metrics.updateCount,
            metrics.updateCount >= MIN_UPDATES_BEFORE_REBALANCE
        );
    }

    /**
     * @dev Optimized rebalancing with minimum liquidity check and safety buffer
     */
    function _rebalanceLiquidity(address token, uint256 subscriberCount) internal {
        // Replace multiple DebugLog emissions with focused metrics
        emit RebalanceMetrics(
            token,
            ethReserves[token],
            ethReserves[token],
            "Rebalance completed"
        );

        // Skip if pool has insufficient liquidity
        if (ethReserves[token] < MIN_LIQUIDITY) {
            emit RebalanceSkipped(
                token,
                ethReserves[token],
                "Insufficient liquidity"
            );
            return;
        }

        // AI-based liquidity calculation
        uint256 newReserveEth = calculateOptimalLiquidity(subscriberCount);
        
        // Calculate minimum safe liquidity with buffer
        uint256 minimumSafeLiquidity = MIN_LIQUIDITY + (MIN_LIQUIDITY * LIQUIDITY_SAFETY_BUFFER / 100);
        
        // Log safety threshold
        emit LiquidityThresholds(
            token,
            MIN_LIQUIDITY,
            minimumSafeLiquidity,
            newReserveEth
        );

        // Enforce minimum safe liquidity
        if (newReserveEth < minimumSafeLiquidity) {
            emit RebalanceAdjusted(
                token,
                newReserveEth,
                minimumSafeLiquidity,
                "Enforcing safety buffer"
            );
            newReserveEth = minimumSafeLiquidity;
        }
        
        // Cap at maximum liquidity
        if (newReserveEth > maxLiquidityPerPool) {
            newReserveEth = maxLiquidityPerPool;
            emit LiquidityCapped(token, maxLiquidityPerPool);
        }
        
        // Log pre-update state
        emit LiquidityOperation("pre_update_state", token, ethReserves[token], newReserveEth);
        
        // Update liquidity
        uint256 oldReserve = ethReserves[token];
        ethReserves[token] = newReserveEth;
        
        // Log final state
        emit PoolMetrics(token, creatorTokenReserves[token], ethReserves[token], maxLiquidityPerPool);
        emit LiquidityRebalanced(token, newReserveEth);
        emit RebalanceMetrics(token, oldReserve, newReserveEth, "Rebalance completed");
    }

    /**
     * @dev Calculates optimal liquidity with overflow protection
     * @param subscriberCount Number of subscribers to base calculation on
     * @return uint256 Optimal liquidity amount
     */
    function calculateOptimalLiquidity(
        uint256 subscriberCount
    ) internal pure returns (uint256) {
        // Check for overflow before multiplication
        require(
            subscriberCount <= type(uint256).max / 1e18, 
            "Overflow risk in liquidity calculation"
        );

        return subscriberCount * 1e18;
    }

    // Daily rebalance check
    function checkAndRebalance(address token) external {
        require(
            block.timestamp >= lastRebalanceTimestamp + REBALANCE_INTERVAL,
            "Too early for rebalance"
        );
        
        EngagementMetrics storage metrics = tokenEngagement[token];
        _rebalanceLiquidity(token, metrics.lastSubscriberCount);
        lastRebalanceTimestamp = block.timestamp;
    }

    /**
     * @dev Redeploys collected fees to target pool with proper token handling
     */
    function redeployFees(
        address token, 
        address targetPool
    ) public onlyOwner {
        // Replace multiple DebugLog emissions with single focused event
        emit FeeOperation(
            "redeploy",
            token,
            0,
            targetPool
        );

        // Check fee amount
        uint256 feeAmount = collectedFees[token];
        
        // Skip if no fees to redeploy
        if (feeAmount == 0) {
            emit DeploymentSkipped(targetPool, feeAmount, "No fees to redeploy");
            return;
        }

        // Validate minimum fee amount
        if (feeAmount < MIN_FEES_FOR_REDEPLOY) {
            emit DeploymentSkipped(targetPool, feeAmount, "Below minimum fee threshold");
            return;
        }

        // Check contract balance before transfer
        uint256 contractBalance;
        if (isETH(token)) {
            contractBalance = address(this).balance;
        } else {
            contractBalance = IERC20(token).balanceOf(address(this));
        }

        // Log balance check
        emit PoolMetrics(token, contractBalance, feeAmount, 0);

        // Ensure sufficient balance
        if (contractBalance < feeAmount) {
            emit DeploymentSkipped(targetPool, feeAmount, "Insufficient contract balance");
            return;
        }

        // Update state before transfer
        collectedFees[token] = 0;

        // Handle transfer and update reserves
        if (isETH(token)) {
            // Handle ETH
            ethReserves[targetPool] += feeAmount;
            transferETH(payable(targetPool), feeAmount);
            emit FeesRedeployed(token, feeAmount, targetPool);
        } else {
            // Handle other ERC20 tokens
            IERC20(token).safeTransfer(targetPool, feeAmount);
            emit FeesRedeployed(token, feeAmount, targetPool);
        }

        // Final success log
        emit FeeOperation("completed", token, feeAmount, targetPool);
    }

    /**
     * @dev Auto redeploys fees when threshold is reached
     * @param token The ERC20 token address whose fees to redeploy
     */
    function autoRedeployFees(address token) external returns (bool) {
        require(msg.sender == dex, "Only DEX can redeploy fees");
        require(isTrackedPool[token], "Pool not tracked");
        
        uint256 feeAmount = collectedFees[token];
        if (feeAmount == 0) return true;  // Nothing to redeploy

        // Get current reserves
        (uint256 currentCreatorReserve, uint256 currentEthReserve) = getReserves(token);
        
        // Check if adding fees would exceed max liquidity
        uint256 remainingLiquidity = maxLiquidityPerPool - currentEthReserve;
        if (feeAmount > remainingLiquidity) {
            feeAmount = remainingLiquidity;
        }

        if (feeAmount > 0) {
            // Update reserves with redeployed fees
            _updateReserves(
                token,
                currentCreatorReserve + feeAmount,  // Add equal amount to creator side
                currentEthReserve + feeAmount     // Add fees to eth side
            );

            // Reset collected fees
            collectedFees[token] = 0;

            emit LiquidityOperation("fee_redeployment", token, feeAmount, feeAmount);
            return true;
        }

        return false;
    }

    /**
     * @dev Finds optimal pool for redeployment with immediate fallback
     */
    function findOptimalRedeploymentPool() internal returns (address) {
        // Check if current best pool is invalid or inactive
        if (!isTrackedPool[mostNeededPool.pool] || 
            !isPoolActive(mostNeededPool.pool) ||
            block.timestamp >= mostNeededPool.lastUpdateTime + POOL_NEED_UPDATE_INTERVAL) {
            
            emit LiquidityOperation("forcing_pool_update", address(0), block.timestamp, 0);
            
            updateMostNeededPool();
        }

        // Verify the pool is still valid after update
        if (!isTrackedPool[mostNeededPool.pool] || !isPoolActive(mostNeededPool.pool)) {
            emit LiquidityOperation("no_valid_pools_found", address(0), block.timestamp, 0);
            return address(0);
        }

        return mostNeededPool.pool;
    }

    /**
     * @dev Updates most needed pool with batch processing
     */
    function updateMostNeededPool() internal {
        // Replace multiple DebugLog emissions with single focused event
        emit PoolOperation(
            "pool_need_update_started",
            address(0),
            lastProcessedIndex,
            trackedPools.length
        );

        uint256 startIndex = lastProcessedIndex;
        uint256 endIndex = Math.min(
            startIndex + BATCH_SIZE,
            trackedPools.length
        );

        // Process pools in batches
        uint256 highestScore = 0;
        address bestPool = address(0);

        for (uint256 i = startIndex; i < endIndex; i++) {
            address pool = trackedPools[i];
            
            // Skip inactive pools
            if (!isPoolActive(pool)) {
                emit PoolOperation("pool_inactive", pool, 0, 0);
                continue;
            }
            
            // Calculate and update pool score
            uint256 score = calculatePoolScore(pool);
            
            // Update pool score in priority queue
            uint256 index = poolScoreIndex[pool];
            if (index == 0) {
                // New pool
                poolScores.push(PoolScore({
                    pool: pool,
                    score: score,
                    lastUpdateTime: block.timestamp
                }));
                poolScoreIndex[pool] = poolScores.length;
            } else {
                // Update existing pool
                poolScores[index - 1].score = score;
                poolScores[index - 1].lastUpdateTime = block.timestamp;
            }

            // Track highest score in this batch
            if (score > highestScore) {
                highestScore = score;
                bestPool = pool;
            }

            emit PoolOperation("pool_processed", pool, score, block.timestamp);
        }

        // Update last processed index
        lastProcessedIndex = endIndex % trackedPools.length;

        // Update most needed pool if we found a better one
        if (bestPool != address(0) && 
            (highestScore > mostNeededPool.score || 
             !isPoolActive(mostNeededPool.pool))) {
            
            mostNeededPool.pool = bestPool;
            mostNeededPool.score = highestScore;
            mostNeededPool.lastUpdateTime = block.timestamp;

            emit PoolOperation("pool_need_updated", bestPool, highestScore, block.timestamp);
        }

        // Log batch completion
        emit PoolOperation("batch_update_completed", bestPool, highestScore, block.timestamp);
    }

    // Add new event for batch processing
    event DebugPoolProcessed(
        address indexed pool,
        uint256 score,
        uint256 currentIndex,
        uint256 batchEndIndex
    );

    /**
     * @dev View function to get current pool need info
     */
    function getPoolNeedInfo() external view returns (
        address pool,
        uint256 score,
        uint256 lastUpdate,
        bool isStale
    ) {
        return (
            mostNeededPool.pool,
            mostNeededPool.score,
            mostNeededPool.lastUpdateTime,
            block.timestamp >= mostNeededPool.lastUpdateTime + POOL_NEED_UPDATE_INTERVAL
        );
    }

    /**
     * @dev Allows removal of inactive pools from tracking
     */
    function removePoolFromTracking(address pool) external onlyOwner {
        require(isTrackedPool[pool], "Pool not tracked");
        
        // Find and remove from array
        for (uint i = 0; i < trackedPools.length; i++) {
            if (trackedPools[i] == pool) {
                // Move last element to this position (unless we're at the end)
                if (i != trackedPools.length - 1) {
                    trackedPools[i] = trackedPools[trackedPools.length - 1];
                }
                trackedPools.pop();
                break;
            }
        }
        
        isTrackedPool[pool] = false;
        emit PoolOperation("pool_untracked", pool, 0, block.timestamp);
    }

    /**
     * @dev View function to get all tracked pools
     */
    function getTrackedPools() external view returns (address[] memory) {
        return trackedPools;
    }

    /**
     * @dev Starts price discovery period for a new token
     */
    function startPriceDiscovery(
        address token,
        uint256 initialSubscribers
    ) external payable onlyOwner {
        require(!priceDiscovery[token].isInDiscovery, "Already in discovery");
        
        priceDiscovery[token] = PriceDiscoveryData({
            initialSubscribers: initialSubscribers,
            currentSubscribers: initialSubscribers,
            observationStartTime: block.timestamp,
            isInDiscovery: true,
            engagementSnapshots: new uint256[](0)
        });
        
        emit PriceDiscoveryStarted(token, initialSubscribers);
    }

    /**
     * @dev Records engagement snapshot during discovery period
     */
    function recordEngagementSnapshot(
        address token,
        uint256 currentSubscribers
    ) external onlyOwner {
        PriceDiscoveryData storage data = priceDiscovery[token];
        require(data.isInDiscovery, "Not in discovery");
        require(
            data.engagementSnapshots.length < MAX_SNAPSHOTS,
            "Max snapshots reached"
        );
        
        data.engagementSnapshots.push(currentSubscribers);
        data.currentSubscribers = currentSubscribers;
        
        emit EngagementSnapshotTaken(token, currentSubscribers, block.timestamp);
        
        // If we have enough snapshots, complete discovery
        if (data.engagementSnapshots.length == MAX_SNAPSHOTS) {
            completePriceDiscovery(token);
        }
    }

    /**
     * @dev Calculates initial liquidity for a specific token
     * @param token The token address
     * @return uint256 The calculated initial liquidity
     */
    function calculateInitialLiquidity(
        address token
    ) public returns (uint256) {
        PriceDiscoveryData storage data = priceDiscovery[token];
        uint256 price = calculateInitialPrice(token);
        return calculateInitialLiquidity(data.currentSubscribers, price);
    }

    /**
     * @dev Calculates initial liquidity based on subscriber count and ETH price
     */
    function calculateInitialLiquidity(
        uint256 subscriberCount,
        uint256 price
    ) public returns (uint256) {
        emit LiquidityOperation(
            "initial_liquidity_calculation_started",
            address(0),
            subscriberCount,
            price
        );

        // Input validation with detailed errors
        require(subscriberCount > 0, "Invalid subscriber count");
        require(price > 0, "Price cannot be zero");
        require(price >= MIN_TOKEN_PRICE, "Price below minimum");
        require(price <= BASE_PRICE * MAX_PRICE_MULTIPLIER, "Price above maximum");

        // Simplified overflow protection
        require(
            subscriberCount <= type(uint256).max / price, 
            "Multiplication overflow"
        );
        
        // Calculate initial liquidity
        uint256 liquidity = subscriberCount * price;
        
        // Log pre-cap liquidity
        emit LiquidityOperation("pre_cap_liquidity", address(0), liquidity, maxLiquidityPerPool);
        
        // Cap liquidity at maximum if needed
        if (liquidity > maxLiquidityPerPool) {
            emit LiquidityCapped(address(0), maxLiquidityPerPool);
            return maxLiquidityPerPool;
        }

        // Ensure minimum liquidity with detailed error
        require(liquidity >= MIN_LIQUIDITY, "Liquidity below minimum");

        // Log final calculated liquidity
        emit LiquidityOperation("final_liquidity_calculated", address(0), liquidity, price);

        return liquidity;
    }

    /**
     * @dev Completes the price discovery process for a creator token
     * @param creatorToken The creator token address
     */
    function completePriceDiscovery(address creatorToken) public onlyOwner {
        require(isTrackedPool[creatorToken], "Pool not tracked");
        require(priceDiscovery[creatorToken].isInDiscovery, "Not in price discovery");
        
        // Calculate initial liquidity based on engagement data
        uint256 initialEthLiquidity = calculateInitialLiquidity(creatorToken);
        
        // Update reserves
        _updateReserves(creatorToken, creatorTokenReserves[creatorToken], initialEthLiquidity);
        
        // Mark price discovery as complete
        priceDiscovery[creatorToken].isInDiscovery = false;
        
        // Emit event
        emit LiquidityAdded(
            creatorToken,
            0, // No creator tokens added initially
            initialEthLiquidity,
            initialEthLiquidity // Liquidity amount
        );
    }

    /**
     * @dev Calculates initial price based on engagement trends with circuit breaker
     */
    function calculateInitialPrice(
        address token
    ) internal returns (uint256) {
        PriceDiscoveryData storage data = priceDiscovery[token];
        
        // Calculate engagement growth rate
        uint256 totalGrowth = 0;
        uint256 positiveSnapshots = 0;
        
        for (uint256 i = 0; i < data.engagementSnapshots.length; i++) {
            if (i > 0) {
                // Handle potential negative growth
                if (data.engagementSnapshots[i] > data.engagementSnapshots[i-1]) {
                    uint256 growth = ((data.engagementSnapshots[i] - data.engagementSnapshots[i-1]) * 10000) 
                                    / data.engagementSnapshots[i-1];
                    
                    // Cap individual growth rate
                    growth = growth > 10000 ? 10000 : growth; // Cap at 100% per snapshot
                    
                    totalGrowth += growth;
                    positiveSnapshots++;
                }
            }
        }
        
        // Calculate average growth, defaulting to 0 if no positive growth
        uint256 avgGrowth = positiveSnapshots > 0 ? 
            totalGrowth / positiveSnapshots : 
            0;
        
        // Calculate price with growth rate
        uint256 calculatedPrice = BASE_PRICE + ((BASE_PRICE * avgGrowth) / 10000);
        
        // Calculate maximum allowed price
        uint256 maxAllowedPrice = BASE_PRICE * MAX_PRICE_MULTIPLIER;
        
        // Apply circuit breaker logic
        if (calculatedPrice > maxAllowedPrice) {
            emit PriceCapReached(token, calculatedPrice, maxAllowedPrice);
            calculatedPrice = maxAllowedPrice;
        }
        
        return calculatedPrice > MIN_TOKEN_PRICE ? calculatedPrice : MIN_TOKEN_PRICE;
    }

    // Add event for monitoring price caps
    event PriceCapReached(
        address indexed token,
        uint256 calculatedPrice,
        uint256 cappedPrice
    );

    // Add event for fallback pool selection
    event FallbackPoolSelected(
        address indexed pool,
        uint256 reserveAmount
    );

    // Add event for skipped rebalances
    event RebalanceSkipped(
        address indexed token,
        uint256 currentValue,
        string reason
    );

    // Enhanced pool selection event
    event PoolSelected(
        address indexed pool,
        uint256 score,
        uint256 currentLiquidity
    );

    /**
     * @dev Updates pool trading activity with historical tracking
     */
    function updatePoolActivity(
        address pool,
        uint256 tradeAmount
    ) external onlyDEX {
        // Cache storage pointer
        PoolActivity storage activity = poolActivity[pool];
        
        // Cache current values
        uint256 currentVolume = activity.tradingVolume24h;
        uint256 lastUpdate = activity.lastVolumeUpdateTime;
        
        emit LiquidityOperation(
            "pool_activity_update_started",
            pool,
            tradeAmount,
            block.timestamp
        );

        // Update last trade timestamp (single storage write)
        activity.lastTradeTimestamp = block.timestamp;
        
        // Check if 24 hours have passed
        if (block.timestamp >= lastUpdate + 24 hours) {
            // Store historical data
            if (volumeHistory[pool].length >= MAX_HISTORY_ENTRIES) {
                // Optimize array manipulation
                uint256 lastIndex = volumeHistory[pool].length - 1;
                for (uint i = 0; i < lastIndex; i++) {
                    volumeHistory[pool][i] = volumeHistory[pool][i + 1];
                }
                volumeHistory[pool].pop();
            }
            
            // Add new entry (single storage write)
            volumeHistory[pool].push(VolumeHistory({
                lastRecordedVolume: currentVolume,
                timestamp: block.timestamp
            }));

            // Reset volume (single storage write)
            activity.tradingVolume24h = tradeAmount;
            activity.lastVolumeUpdateTime = block.timestamp;
            
            emit VolumeReset(pool, currentVolume, block.timestamp);
        } else {
            // Update volume (single storage write)
            activity.tradingVolume24h = currentVolume + tradeAmount;
        }
        
        emit PoolActivityUpdated(pool, activity.tradingVolume24h);
    }

    // Add new event for volume resets
    event VolumeReset(
        address indexed pool,
        uint256 lastVolume,
        uint256 timestamp
    );

    // Add view function to get historical volume data
    function getVolumeHistory(
        address pool
    ) external view returns (VolumeHistory[] memory) {
        return volumeHistory[pool];
    }

    // Add new event for detailed pool activity tracking
    event DebugPoolActivity(
        address indexed pool,
        uint256 currentVolume,
        uint256 lastUpdateTime,
        uint256 currentTime
    );

    /**
     * @dev Checks if pool is actively traded
     */
    function isPoolActive(address pool) public view returns (bool) {
        PoolActivity storage activity = poolActivity[pool];
        uint256 lastTrade = activity.lastTradeTimestamp;
        
        // Check for uninitialized or inactive pools
        if (lastTrade == 0 || lastTrade + ACTIVITY_THRESHOLD < block.timestamp) {
            return false;
        }

        return activity.tradingVolume24h >= MIN_24H_VOLUME;
    }

    // Replace multiple debug events with a single comprehensive event
    event PoolScoreCalculated(
        address indexed pool,
        uint256 finalScore,
        uint256 liquidity,
        uint256 volume,
        uint256 liquidityWeight,
        uint256 volumeWeight
    );

    /**
     * @dev Calculates pool score based on liquidity and activity with market-based dynamic weighting
     */
    function calculatePoolScore(
        address pool
    ) internal returns (uint256) {
        // Cache values to save gas
        uint256 liquidity = ethReserves[pool];
        uint256 volume = poolActivity[pool].tradingVolume24h;
        
        // Calculate dynamic weights based on market conditions
        uint256 dynamicWeightLiquidity = 5 + (liquidity / (10_000 * 1e18)); // Base 5 + up to 5 based on liquidity
        uint256 dynamicWeightVolume = 3 + (volume / (5_000 * 1e18));  // Base 3 + up to 7 based on volume

        // Cap weights to prevent overflow
        dynamicWeightLiquidity = dynamicWeightLiquidity > 10 ? 10 : dynamicWeightLiquidity;
        dynamicWeightVolume = dynamicWeightVolume > 10 ? 10 : dynamicWeightVolume;

        // Calculate score with dynamic market-based weights
        uint256 liquidityScore = liquidity * dynamicWeightLiquidity;
        uint256 volumeScore = volume * dynamicWeightVolume;
        
        // Calculate final score
        uint256 score = (liquidityScore + volumeScore) / 10;

        // Single event with all relevant data
        emit PoolScoreCalculated(
            pool,
            score,
            liquidity,
            volume,
            dynamicWeightLiquidity,
            dynamicWeightVolume
        );

        return score;
    }

    /**
     * @dev Calculates the optimal amount of fees to deploy to a pool
     * @param targetPool The pool to deploy fees to
     * @param availableFees Total available fees
     * @return Amount of fees to deploy
     */
    function calculateOptimalDeployment(
        address targetPool,
        uint256 availableFees
    ) internal view returns (uint256) {
        // Safety check: Ensure valid target pool
        if (targetPool == address(0)) {
            return 0;
        }

        // Ensure minimum available fees
        if (availableFees < MIN_DEPLOYMENT_AMOUNT) {
            return 0;
        }

        // Get current pool metrics
        uint256 currentLiquidity = ethReserves[targetPool];
        PoolActivity memory activity = poolActivity[targetPool];

        uint256 deployAmount;

        // Calculate deployment amount based on conditions
        if (currentLiquidity < MIN_LIQUIDITY) {
            // If pool has low liquidity, deploy all available fees
            deployAmount = availableFees;
        } else if (activity.tradingVolume24h > MIN_24H_VOLUME * 2) {
            // If pool is highly active, deploy 75% of available fees
            deployAmount = (availableFees * 75) / 100;
        } else {
            // Default case: Deploy 50% of available fees
            deployAmount = availableFees / 2;
        }

        // Ensure minimum deployment amount
        if (deployAmount < MIN_DEPLOYMENT_AMOUNT) {
            return 0; // Don't deploy if below minimum
        }

        // Cap deployment at available fees
        return deployAmount > availableFees ? availableFees : deployAmount;
    }

    /**
     * @dev Transfers ETH to the given address
     * @param to Recipient address
     * @param amount Amount to transfer in wei
     */
    function transferETH(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @dev Enhanced modifier for DEX access control
     */
    modifier onlyDEX() {
        require(
            msg.sender == dex || 
            hasRole(DEX_ROLE, msg.sender) || 
            hasRole(BACKUP_DEX_ROLE, msg.sender),
            "Caller is not authorized DEX"
        );
        
        // Log access attempt
        emit RoleOperation("access_attempt", msg.sender, DEX_ROLE);
        _;
    }

    /**
     * @dev Allows owner to set primary DEX address
     */
    function setDEX(address _dex) external onlyOwner {
        require(_dex != address(0), "Invalid DEX address");
        require(_dex != dex, "Already primary DEX");
        
        address oldDex = dex;
        dex = _dex;
        
        // Grant DEX role to new address
        _grantRole(DEX_ROLE, _dex);
        emit RoleOperation("grant", _dex, DEX_ROLE);
        
        // Fix type mismatch by using uint256(uint160()) to convert address to uint256
        emit LiquidityOperation(
            "dex_updated", 
            address(0),  // token parameter
            uint256(uint160(oldDex)),  // amount parameter
            block.timestamp
        );
    }

    /**
     * @dev Grants backup DEX role to address
     */
    function grantBackupDEXRole(address account) external onlyOwner {
        require(account != address(0), "Invalid address");
        require(account != dex, "Already primary DEX");
        require(!hasRole(BACKUP_DEX_ROLE, account), "Already backup DEX");
        
        _grantRole(BACKUP_DEX_ROLE, account);
        emit RoleOperation("grant", account, BACKUP_DEX_ROLE);
    }

    /**
     * @dev Revokes DEX role from address
     */
    function revokeDEXRole(address account) external onlyOwner {
        require(account != address(0), "Invalid address");
        require(account != dex, "Cannot revoke from primary DEX");
        
        if (hasRole(DEX_ROLE, account)) {
            _revokeRole(DEX_ROLE, account);
        }
        if (hasRole(BACKUP_DEX_ROLE, account)) {
            _revokeRole(BACKUP_DEX_ROLE, account);
        }
        
        emit RoleOperation("revoke", account, DEX_ROLE);
    }

    // Consolidate role management events
    event RoleOperation(
        string operation,  // "grant", "revoke"
        address indexed account,
        bytes32 indexed role
    );

    // Add event for liquidity capping
    event LiquidityCapped(
        address indexed token,
        uint256 cappedAmount
    );

    /**
     * @dev Helper function to validate if a liquidity amount is within acceptable bounds
     * @param liquidity Amount to validate
     * @return bool True if liquidity is valid
     */
    function isValidLiquidity(uint256 liquidity) public view returns (bool) {
        return liquidity >= MIN_LIQUIDITY && 
               liquidity <= maxLiquidityPerPool;
    }

    // Add event for skipped deployments
    event DeploymentSkipped(
        address indexed targetPool,
        uint256 amount,
        string reason
    );

    /**
     * @dev Updates the maximum liquidity per pool with safety checks
     * @param newMax New maximum liquidity value
     */
    function updateMaxLiquidityPerPool(uint256 newMax) external onlyOwner {
        require(newMax >= MIN_LIQUIDITY, "Below minimum");
        require(newMax <= ABSOLUTE_MAX_LIQUIDITY, "Exceeds absolute limit");
        
        // Store old value for event
        uint256 oldMax = maxLiquidityPerPool;
        
        // Update max liquidity
        maxLiquidityPerPool = newMax;
        
        // Emit event
        emit MaxLiquidityUpdated(oldMax, newMax);
    }

    // Add new event for max liquidity checks
    event LiquidityThresholds(
        address indexed highestPool,
        uint256 highestReserve,
        uint256 proposedMax
    );

    // Add new event for max liquidity validation
    event LiquidityValidation(
        uint256 proposedMax,
        uint256 absoluteMax,
        bool withinLimits
    );

    // Add new event for detailed liquidity calculation tracking
    event LiquidityCalculation(
        uint256 subscriberCount,
        uint256 price,
        uint256 calculatedLiquidity,
        bool wasCapped
    );

    // Add new event for pool status debugging
    event DebugPoolStatus(
        address indexed pool,
        bool isTracked,
        bool isActive,
        uint256 score
    );

    // Add new events for liquidity safety tracking
    event LiquidityThresholds(
        address indexed token,
        uint256 minimumLiquidity,
        uint256 safeLiquidity,
        uint256 calculatedLiquidity
    );

    event RebalanceAdjusted(
        address indexed token,
        uint256 originalAmount,
        uint256 adjustedAmount,
        string reason
    );

    /**
     * @dev Allows owner to whitelist addresses for fee withdrawal
     */
    function whitelistWithdrawAddress(address account) external onlyOwner {
        require(account != address(0), "Invalid address");
        require(!whitelistedWithdrawAddresses[account], "Address already whitelisted");
        
        whitelistedWithdrawAddresses[account] = true;
        emit RoleOperation("whitelist_address", account, keccak256("withdraw"));
    }

    /**
     * @dev Allows owner to remove addresses from withdrawal whitelist
     */
    function removeWithdrawAddress(address account) external onlyOwner {
        require(whitelistedWithdrawAddresses[account], "Address not whitelisted");
        
        whitelistedWithdrawAddresses[account] = false;
        emit RoleOperation("revoke", account, keccak256("withdraw"));
    }

    // Add new event for withdrawal attempts
    event WithdrawalAttempt(
        address indexed caller,
        bool isWhitelisted,
        uint256 requestedAmount,
        uint256 timestamp
    );

    // Add new events for engagement tracking
    event EngagementChangeCalculated(
        address indexed token,
        uint256 oldCount,
        uint256 newCount,
        uint256 percentChange
    );

    event EngagementInitialized(
        address indexed token,
        uint256 initialCount,
        uint256 timestamp
    );

    /**
     * @dev Updates pool score and maintains sorted order
     */
    function updatePoolScore(address pool, uint256 newScore) internal {
        // Replace multiple debug events with single metrics event
        emit PoolMetrics(
            pool,
            ethReserves[pool],
            poolActivity[pool].tradingVolume24h,
            newScore
        );

        uint256 poolIndex = poolScoreIndex[pool];
        
        if (poolIndex == 0) {
            // New pool - insert into sorted list
            poolCount++;
            poolIndex = poolCount;
            poolScoreIndex[pool] = poolIndex;
            
            sortedPools[poolIndex] = SortedPool({
                pool: pool,
                score: newScore,
                lastUpdateTime: block.timestamp,
                nextIndex: 0,
                prevIndex: 0
            });

            // Insert into sorted position
            insertSortedPool(poolIndex);
            
            emit PoolOperation("pool_added", pool, newScore, block.timestamp);
        } else {
            // Update existing pool
            SortedPool storage poolData = sortedPools[poolIndex];
            uint256 oldScore = poolData.score;
            poolData.score = newScore;
            poolData.lastUpdateTime = block.timestamp;

            // Reposition if score changed
            if (newScore != oldScore) {
                removeSortedPool(poolIndex);
                insertSortedPool(poolIndex);
            }
            
            emit PoolOperation("pool_updated", pool, oldScore, newScore);
        }
    }

    /**
     * @dev Inserts pool into sorted position
     */
    function insertSortedPool(uint256 poolIndex) internal {
        SortedPool storage newPool = sortedPools[poolIndex];
        
        // If this is the first pool
        if (topPoolIndex == 0) {
            topPoolIndex = poolIndex;
            return;
        }

        // Find insertion point
        uint256 currentIndex = topPoolIndex;
        uint256 prevIndex = 0;
        
        while (currentIndex != 0 && 
               sortedPools[currentIndex].score > newPool.score) {
            prevIndex = currentIndex;
            currentIndex = sortedPools[currentIndex].nextIndex;
        }

        // Insert pool
        if (prevIndex == 0) {
            // Insert at top
            newPool.nextIndex = topPoolIndex;
            sortedPools[topPoolIndex].prevIndex = poolIndex;
            topPoolIndex = poolIndex;
        } else {
            // Insert between pools
            newPool.nextIndex = currentIndex;
            newPool.prevIndex = prevIndex;
            sortedPools[prevIndex].nextIndex = poolIndex;
            if (currentIndex != 0) {
                sortedPools[currentIndex].prevIndex = poolIndex;
            }
        }
    }

    /**
     * @dev Removes pool from sorted list
     */
    function removeSortedPool(uint256 poolIndex) internal {
        SortedPool storage pool = sortedPools[poolIndex];
        
        if (poolIndex == topPoolIndex) {
            topPoolIndex = pool.nextIndex;
        } else {
            if (pool.prevIndex != 0) {
                sortedPools[pool.prevIndex].nextIndex = pool.nextIndex;
            }
            if (pool.nextIndex != 0) {
                sortedPools[pool.nextIndex].prevIndex = pool.prevIndex;
            }
        }
    }

    /**
     * @dev Gets top N pools by score
     */
    function getTopPools(uint256 n) external view returns (address[] memory) {
        address[] memory topPools = new address[](n);
        uint256 count = 0;
        uint256 currentIndex = topPoolIndex;
        
        while (currentIndex != 0 && count < n) {
            SortedPool storage pool = sortedPools[currentIndex];
            if (isPoolActive(pool.pool)) {
                topPools[count] = pool.pool;
                count++;
            }
            currentIndex = pool.nextIndex;
        }
        
        return topPools;
    }

    // Add new events for pool tracking
    event PoolAdded(
        address indexed pool,
        uint256 initialScore,
        uint256 index
    );

    event PoolUpdated(
        address indexed pool,
        uint256 oldScore,
        uint256 newScore,
        uint256 index
    );

    event PoolLiquidityCheck(
        address indexed pool,
        uint256 currentReserve,
        uint256 maxLimit
    );

    /**
     * @dev Returns the minimum of two numbers
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev If you need a view version that doesn't emit events, 
     * create a separate function
     */
    function calculatePoolScoreView(
        address pool
    ) internal view returns (uint256) {
        // Cache values to save gas
        uint256 liquidity = ethReserves[pool];
        uint256 volume = poolActivity[pool].tradingVolume24h;

        // Calculate dynamic weights based on market conditions
        uint256 dynamicWeightLiquidity = 5 + (liquidity / (10_000 * 1e18));
        uint256 dynamicWeightVolume = 3 + (volume / (5_000 * 1e18));

        // Cap weights to prevent overflow
        dynamicWeightLiquidity = dynamicWeightLiquidity > 10 ? 10 : dynamicWeightLiquidity;
        dynamicWeightVolume = dynamicWeightVolume > 10 ? 10 : dynamicWeightVolume;

        // Calculate score with dynamic market-based weights
        uint256 liquidityScore = liquidity * dynamicWeightLiquidity;
        uint256 volumeScore = volume * dynamicWeightVolume;
        
        // Calculate final score
        return (liquidityScore + volumeScore) / 10;
    }

    /**
     * @dev Adds creator token liquidity to the pool without requiring ETH
     * @param creatorToken The creator token address
     * @param creatorTokenAmount The amount of creator tokens to add
     */
    function addCreatorTokenLiquidity(
        address creatorToken,
        uint256 creatorTokenAmount
    ) external nonReentrant {
        // Validate inputs
        require(isTrackedPool[creatorToken], "Pool not tracked");
        require(!priceDiscovery[creatorToken].isInDiscovery, "Token in price discovery");
        require(creatorTokenAmount >= MIN_LIQUIDITY, "Amount below minimum");
        
        // Get current reserves
        (uint256 reserveCreator, uint256 reserveEth) = getReserves(creatorToken);
        
        // Ensure ETH reserve exists
        require(reserveEth > 0, "No ETH liquidity exists");
        
        // Transfer creator tokens from sender to this contract
        IERC20(creatorToken).safeTransferFrom(msg.sender, address(this), creatorTokenAmount);
        
        // Update reserves
        _updateReserves(creatorToken, reserveCreator + creatorTokenAmount, reserveEth);
        
        // Emit event
        emit LiquidityAdded(
            creatorToken,
            creatorTokenAmount,
            0, // No ETH tokens added
            creatorTokenAmount // Liquidity amount equals creator token amount
        );
    }

    /**
     * @dev Receives ETH from DEX during swaps
     */
    function receiveETH() external payable nonReentrant {
        require(msg.sender == dex || hasRole(DEX_ROLE, msg.sender), "Unauthorized");
        emit ETHReceived(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @dev Transfers ETH to DEX when requested
     * @param amount Amount of ETH to transfer to DEX
     */
    function transferETHToDEX(uint256 amount) external nonReentrant {
        require(msg.sender == dex || hasRole(DEX_ROLE, msg.sender), "Unauthorized");
        require(address(this).balance >= amount, "Insufficient ETH balance");
        
        (bool success,) = payable(dex).call{value: amount, gas: 50000}("");
        require(success, "Failed to transfer ETH to DEX");
        
        emit ETHTransferredToDEX(amount, block.timestamp);
    }

    /**
     * @dev Safely transfers ETH to an address with gas limit
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransferETH(address to, uint256 amount) internal returns (bool) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than zero");
        
        (bool success,) = payable(to).call{value: amount, gas: 30000}("");
        require(success, "ETH transfer failed");
        
        return true;
    }

    // Update event to include timestamp
    event ETHTransferred(
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    event ETHReceived(
        address indexed from,
        uint256 amount,
        uint256 timestamp
    );

    event ETHTransferredToDEX(
        uint256 amount,
        uint256 timestamp
    );

}