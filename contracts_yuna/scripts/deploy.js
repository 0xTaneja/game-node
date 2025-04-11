const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
const path = require('path');

// No CORAL token is needed for Base deployment as we're using native ETH

async function main() {
  console.log("\n---------------------");
  console.log("🚀 Starting Deployment");
  console.log("---------------------\n");

  // Get the deployer's address and network info
  const [deployer] = await ethers.getSigners();
  const networkName = network.name || `chain-${network.chainId}`;

  console.log("Network:", networkName);
  console.log("Deploying with account:", deployer.address);
  
  // Log initial balance
  const initialBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Initial balance:", ethers.formatEther(initialBalance), "ETH\n");

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)){
    fs.mkdirSync(deploymentsDir);
  }

  // 1. Deploy CreatorToken Factory first
  console.log("1. Deploying CreatorToken Factory...");
  const CreatorToken = await ethers.getContractFactory("CreatorToken");
  
  const creatorToken = await upgrades.deployProxy(CreatorToken, 
    [deployer.address], 
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  );

  await creatorToken.waitForDeployment();
  const creatorTokenAddress = await creatorToken.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(creatorTokenAddress);
  
  console.log("✅ CreatorToken deployed:");
  console.log("Proxy:", creatorTokenAddress);
  console.log("Implementation:", implementationAddress);

  // 2. Deploy YunaLiquidityManager - note the constructor has changed
  console.log("\n2. Deploying YunaLiquidityManager...");
  const YunaLiquidityManager = await ethers.getContractFactory("YunaLiquidityManager");
  
  // YunaLiquidityManager constructor doesn't take any parameters and doesn't accept ETH on deployment
  const liquidityManager = await YunaLiquidityManager.deploy();
  
  await liquidityManager.waitForDeployment();
  const liquidityManagerAddress = await liquidityManager.getAddress();
  console.log("✅ YunaLiquidityManager deployed to:", liquidityManagerAddress);
  
  // Add initial ETH liquidity after deployment
  const initialLiquidityAmount = ethers.parseEther("0.3"); // 0.3 ETH for initial liquidity
  console.log(`   Sending initial liquidity: ${ethers.formatEther(initialLiquidityAmount)} ETH`);
  
  // Send ETH directly to liquidity manager
  await (await deployer.sendTransaction({
    to: liquidityManagerAddress,
    value: initialLiquidityAmount
  })).wait();
  
  // Whitelist deployer address for withdrawals
  console.log("   Whitelisting deployer for withdrawals...");
  await (await liquidityManager.whitelistWithdrawAddress(deployer.address)).wait();
  console.log("✅ Deployer whitelisted for withdrawals");

  // 3. Deploy YunaDEX - constructor takes wethToken (optional) and liquidityManager
  console.log("\n3. Deploying YunaDEX...");
  const YunaDEX = await ethers.getContractFactory("YunaDEX");
  // Use address(0) for wethToken if not used
  const yunaDex = await YunaDEX.deploy(ethers.ZeroAddress, liquidityManagerAddress);
  await yunaDex.waitForDeployment();
  const yunaDexAddress = await yunaDex.getAddress();
  console.log("✅ YunaDEX deployed to:", yunaDexAddress);

  // 4. Deploy YunaTokenRouter
  console.log("\n4. Deploying YunaTokenRouter...");
  const YunaTokenRouter = await ethers.getContractFactory("YunaTokenRouter");
  const yunaRouter = await YunaTokenRouter.deploy(
    liquidityManagerAddress, 
    yunaDexAddress,
    creatorTokenAddress  // Creator token factory address
  );
  await yunaRouter.waitForDeployment();
  const yunaRouterAddress = await yunaRouter.getAddress();
  console.log("✅ YunaTokenRouter deployed to:", yunaRouterAddress);

  // Setup initial permissions with explicit await
  console.log("\nSetting up permissions...");
  
  // Grant DEX_ROLE to the DEX in Liquidity Manager
  console.log("1. Granting DEX_ROLE to YunaDEX in Liquidity Manager...");
  // Get the DEX_ROLE bytes32 value
  const DEX_ROLE = await liquidityManager.DEX_ROLE();
  await (await liquidityManager.grantRole(DEX_ROLE, yunaDexAddress)).wait();
  console.log("✅ DEX_ROLE granted to YunaDEX in Liquidity Manager");
  
  // Set the DEX reference in the Liquidity Manager
  console.log("2. Setting DEX reference in Liquidity Manager...");
  await (await liquidityManager.setDEX(yunaDexAddress)).wait();
  console.log("✅ DEX reference set in Liquidity Manager");

  // Calculate and format gas cost once
  const finalBalance = await ethers.provider.getBalance(deployer.address);
  const gasCost = initialBalance - finalBalance;

  const formattedGasCost = ethers.formatEther(gasCost);
  
  console.log("\n⛽ Gas Report");
  console.log("------------");
  console.log(`Total Deploy Cost: ${formattedGasCost} ETH`);

  // Prepare deployment info with correct network name
  const deploymentInfo = {
    network: network.name || network.chainId.toString(), // Fallback to chainId if name is undefined
    creatorToken: {
      proxy: creatorTokenAddress,
      implementation: implementationAddress
    },
    yuna: {
      liquidityManager: liquidityManagerAddress,
      yunaDex: yunaDexAddress,
      yunaRouter: yunaRouterAddress
    },
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    gasCost: formattedGasCost
  };

  // Save to deployments folder with network and timestamp
  const fileName = `deployment-${networkName}-${Date.now()}.json`;

  const filePath = path.join(deploymentsDir, fileName);
  
  fs.writeFileSync(
    filePath,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\n📝 Deployment info saved to ${fileName}`);
  console.log("\nTo verify contracts:");
  console.log("1. CreatorToken Implementation:");
  console.log(`npx hardhat verify ${implementationAddress}`);
  console.log("\n2. YunaLiquidityManager:");
  console.log(`npx hardhat verify ${liquidityManagerAddress}`);
  console.log("\n3. YunaDEX:");
  console.log(`npx hardhat verify ${yunaDexAddress} "${ethers.ZeroAddress}" "${liquidityManagerAddress}"`);
  console.log("\n4. YunaTokenRouter:");
  console.log(
    `npx hardhat verify ${yunaRouterAddress} "${liquidityManagerAddress}" "${yunaDexAddress}" "${creatorTokenAddress}"`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment Failed!");
    console.error(error);
    process.exit(1);
  });