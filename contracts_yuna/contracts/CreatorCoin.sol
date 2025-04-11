// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

// Individual Creator Token
contract CreatorERC20 is ERC20 {
    string public creatorName;
    string public imageURL;
    string public channelLink;
    uint256 public subscribers;
    string public milestone;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _creatorName,
        string memory _imageURL,
        string memory _channelLink,
        uint256 _subscribers,
        string memory _milestone,
        uint256 _initialSupply,
        address _creator
    ) ERC20(_name, _symbol) {
        creatorName = _creatorName;
        imageURL = _imageURL;
        channelLink = _channelLink;
        subscribers = _subscribers;
        milestone = _milestone;
        _mint(_creator, _initialSupply);
    }

    /**
     * @dev Returns all creator metadata in a structured format
     * @return _name Token name
     * @return _symbol Token symbol
     * @return _creatorName Creator's name
     * @return _imageURL Creator's image URL
     * @return _channelLink Creator's channel link
     * @return _subscribers Number of subscribers
     * @return _milestone Achievement milestone
     */
    function getCreatorMetadata() external view returns (
        string memory _name,
        string memory _symbol,
        string memory _creatorName,
        string memory _imageURL,
        string memory _channelLink,
        uint256 _subscribers,
        string memory _milestone
    ) {
        return (
            name(),             // ERC20 name
            symbol(),           // ERC20 symbol
            creatorName,        // Creator's name
            imageURL,           // Creator's image URL
            channelLink,        // Creator's channel link
            subscribers,        // Number of subscribers
            milestone          // Achievement milestone
        );
    }
}

// Factory Contract to Create Individual Tokens
contract CreatorToken is UUPSUpgradeable, OwnableUpgradeable {
    mapping(string => address) public creatorTokens;
    mapping(string => bool) public isTokenMinted;

    event CreatorTokenMinted(
        address indexed tokenAddress,
        string creatorName,
        string channelLink,
        string symbol,
        uint256 supply,
        string milestone
    );

    // Add new events for tracking administrative actions
    event ContractUpgraded(address indexed oldImplementation, address indexed newImplementation);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin) external initializer {
        __Ownable_init(_admin);
        __UUPSUpgradeable_init();
    }

    function mintToken(
        address creator,
        string memory name,
        string memory image,
        string memory channelLink,
        uint256 subscribers
    ) external onlyOwner {
        require(!isTokenMinted[channelLink], "Token already minted for this channel");
        
        string memory symbol = generateSymbol(name);
        string memory tokenName = string(abi.encodePacked(name, " Token"));
        string memory milestone = getMilestone(subscribers);
        uint256 supply = calculateSupply(subscribers);

        CreatorERC20 newToken = new CreatorERC20(
            tokenName,
            symbol,
            name,
            image,
            channelLink,
            subscribers,
            milestone,
            supply,
            creator
        );

        creatorTokens[channelLink] = address(newToken);
        isTokenMinted[channelLink] = true;

        emit CreatorTokenMinted(
            address(newToken),
            name,
            channelLink,
            symbol,
            supply,
            milestone
        );
    }

    function generateSymbol(string memory name) internal pure returns (string memory) {
        // Take first 3 letters of name and uppercase them
        bytes memory nameBytes = bytes(name);
        bytes memory symbol = new bytes(3);
        
        for(uint i = 0; i < 3 && i < nameBytes.length; i++) {
            // Convert to uppercase if lowercase
            bytes1 b = nameBytes[i];
            if(b >= 0x61 && b <= 0x7A) {
                symbol[i] = bytes1(uint8(b) - 32);
            } else {
                symbol[i] = b;
            }
        }
        
        return string(symbol);
    }

    function calculateSupply(uint256 subscribers) internal pure returns (uint256) {
        return subscribers * 10**18;
    }

    function getMilestone(uint256 subscribers) internal pure returns (string memory) {
        if (subscribers >= 10000000) return "10M Subscribers Badge";
        if (subscribers >= 1000000) return "1M Subscribers Badge";
        if (subscribers >= 100000) return "100K Subscribers Badge";
        return "Rising Star Badge";
    }

    function getCreatorToken(string memory channelLink) external view returns (address) {
        return creatorTokens[channelLink];
    }

    /**
     * @dev Override the transferOwnership function to emit our custom event
     */
    function transferOwnership(address newOwner) public virtual override onlyOwner {
        address oldOwner = owner();
        super.transferOwnership(newOwner);
        emit AdminChanged(oldOwner, newOwner);
    }

    /**
     * @dev Override the _authorizeUpgrade function to emit upgrade event
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        emit ContractUpgraded(address(this), newImplementation);
    }

    /**
     * @dev Returns the current implementation address
     * @return The address of the current implementation contract
     */
    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }
}