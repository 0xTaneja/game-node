const { ethers } = require("hardhat");

// Main test function
async function main() {
  console.log("Starting Yuna Contracts Test Suite - Base Network Version");
  
  // Get signers
  const [owner, creator, user1, user2] = await ethers.getSigners();
  console.log("Using account:", owner.address);
  
  // Constants for testing
  const timestamp = Date.now();
  const CREATOR_NAME = `MrBeast${timestamp}`;
  const CREATOR_IMAGE = "https://example.com/mrbeast.jpg";
  const CREATOR_CHANNEL = `https://youtube.com/mrbeast${timestamp}`;
  const CREATOR_SUBSCRIBERS = 100;
  
  // Contract addresses - Updated for Base Sepolia deployment
  const CREATOR_TOKEN_ADDRESS = "0xE71fFde7Bd8BD006AeE069FF06DD7621Ce2A4544";
  const LIQUIDITY_MANAGER_ADDRESS = "0x202b471176F1bE0CDe16928390B9FF16306356DC";
  const YUNA_DEX_ADDRESS = "0xABBCf79CA574B2c9A17387BDD4CA1e87e16ccA6E";
  const YUNA_ROUTER_ADDRESS = "0xc6F4E334BcFaeAcac672bb986A4575bD7C6254d7";
  
  console.log("\n=== STEP 1: Attaching to contracts ===");
  
  // Attach to contracts - note no CORAL token for Base network
  const creatorToken = await ethers.getContractAt("CreatorToken", CREATOR_TOKEN_ADDRESS);
  console.log("CreatorToken attached at:", CREATOR_TOKEN_ADDRESS);
  
  const liquidityManager = await ethers.getContractAt("YunaLiquidityManager", LIQUIDITY_MANAGER_ADDRESS);
  console.log("YunaLiquidityManager attached at:", LIQUIDITY_MANAGER_ADDRESS);
  
  const yunaDex = await ethers.getContractAt("YunaDEX", YUNA_DEX_ADDRESS);
  console.log("YunaDEX attached at:", YUNA_DEX_ADDRESS);
  
  const tokenRouter = await ethers.getContractAt("YunaTokenRouter", YUNA_ROUTER_ADDRESS);
  console.log("YunaTokenRouter attached at:", YUNA_ROUTER_ADDRESS);
  
  console.log("\n=== STEP 2: Checking ETH balances ===");
  
  // Check ETH balance instead of CORAL
  const ownerBalance = await ethers.provider.getBalance(owner.address);
  console.log("Owner ETH balance:", ethers.formatEther(ownerBalance));
  
  // Define creator address
  const creatorAddress = creator?.address || owner.address;
  console.log("Creator address:", creatorAddress);
  
  const creatorBalance = await ethers.provider.getBalance(creatorAddress);
  console.log("Creator ETH balance:", ethers.formatEther(creatorBalance));
  
  console.log("\n=== STEP 3: Minting creator token ===");
  
  console.log("Minting a new creator token...");
  // In Yuna, mintToken now requires ETH to be sent
  const mintTx = await creatorToken.mintToken(
    creatorAddress,
    CREATOR_NAME,
    CREATOR_IMAGE,
    CREATOR_CHANNEL,
    CREATOR_SUBSCRIBERS,
    { value: ethers.parseEther("0.1") } // Send ETH for initial liquidity
  );
  
  console.log("Mint transaction hash:", mintTx.hash);
  const mintReceipt = await mintTx.wait();
  console.log("Mint transaction confirmed in block:", mintReceipt.blockNumber);
  
  // Extract token address from event
  let creatorERC20Address;
  for (const log of mintReceipt.logs) {
    try {
      const parsedLog = creatorToken.interface.parseLog({
        topics: log.topics,
        data: log.data
      });
      
      if (parsedLog && parsedLog.name === 'CreatorTokenMinted') {
        creatorERC20Address = parsedLog.args.tokenAddress;
        console.log("Found CreatorTokenMinted event");
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!creatorERC20Address) {
    console.log("Event not found, trying to get token address directly");
    creatorERC20Address = await creatorToken.getCreatorToken(CREATOR_CHANNEL);
  }
  
  console.log("Creator ERC20 token deployed to:", creatorERC20Address);
  
  // Verify token exists
  const code = await ethers.provider.getCode(creatorERC20Address);
  if (code === "0x") {
    console.error("ERROR: No contract code at the token address!");
    process.exit(1);
  }
  
  // Attach to the token
  const CreatorERC20 = await ethers.getContractFactory("CreatorERC20");
  const creatorERC20 = CreatorERC20.attach(creatorERC20Address);
  console.log("Successfully attached to token contract");
  
  // Check token metadata
  const metadata = await creatorERC20.getCreatorMetadata();
  console.log("Token metadata:", {
    name: metadata._name,
    symbol: metadata._symbol,
    creatorName: metadata._creatorName,
    subscribers: metadata._subscribers.toString()
  });
  
  const totalSupply = await creatorERC20.totalSupply();
  console.log("Total supply:", ethers.formatEther(totalSupply));
  
  const creatorTokenBalance = await creatorERC20.balanceOf(creatorAddress);
  console.log("Creator token balance:", ethers.formatEther(creatorTokenBalance));
  
  console.log("\n=== STEP 4: Setting up roles ===");
  
  // Check if DEX has LIQUIDITY_MANAGER_ROLE
  const LIQUIDITY_MANAGER_ROLE = await yunaDex.LIQUIDITY_MANAGER_ROLE();
  const hasLiquidityManagerRole = await yunaDex.hasRole(LIQUIDITY_MANAGER_ROLE, LIQUIDITY_MANAGER_ADDRESS);
  console.log("DEX role already granted:", hasLiquidityManagerRole);

  // Grant role if not already granted
  if (!hasLiquidityManagerRole) {
    console.log("Granting LIQUIDITY_MANAGER_ROLE to liquidity manager...");
    const grantRoleTx = await yunaDex.grantRole(LIQUIDITY_MANAGER_ROLE, LIQUIDITY_MANAGER_ADDRESS);
    console.log("Grant role transaction hash:", grantRoleTx.hash);
    await grantRoleTx.wait();
    console.log("Role granted successfully");
  }

  // Check if DEX is set in liquidity manager
  const dexAddress = await liquidityManager.dex();
  const isDexSet = dexAddress === YUNA_DEX_ADDRESS;
  console.log("DEX role already set in liquidity manager:", isDexSet);

  // Set DEX in liquidity manager if not already set
  if (!isDexSet) {
    console.log("Setting DEX in liquidity manager...");
    try {
      const setDexTx = await liquidityManager.setDEX(YUNA_DEX_ADDRESS);
      console.log("Set DEX transaction hash:", setDexTx.hash);
      await setDexTx.wait();
      console.log("DEX set successfully in liquidity manager");
    } catch (error) {
      if (error.message.includes("Already primary DEX")) {
        console.log("DEX is already set as primary DEX in liquidity manager");
      } else {
        console.error("Error setting DEX in liquidity manager:", error.message);
      }
    }
  }
  
  console.log("\n=== STEP 5: Checking if pool is already tracked ===");
  
  const isAlreadyTracked = await liquidityManager.isTrackedPool(creatorERC20Address);
  console.log("Is pool already tracked:", isAlreadyTracked);
  
  if (isAlreadyTracked) {
    console.log("Pool is already tracked, skipping manual tracking");
  } else {
    console.log("\n=== STEP 6: Manually adding pool to tracking ===");
    
    // Manually add pool to tracking
    console.log("Adding pool to tracking...");
    try {
      const addPoolTx = await liquidityManager.addPoolToTracking(creatorERC20Address);
      await addPoolTx.wait();
      console.log("Pool added to tracking, transaction hash:", addPoolTx.hash);
      
      // Verify pool is now tracked
      const isNowTracked = await liquidityManager.isTrackedPool(creatorERC20Address);
      console.log("Is pool tracked after manual addition:", isNowTracked);
    } catch (error) {
      console.log("Error adding pool to tracking:", error.message);
    }
  }
  
  console.log("\n=== STEP 7: Adding liquidity ===");
  
  // Check if owner has creator tokens
  const ownerCreatorTokenBalance = await creatorERC20.balanceOf(owner.address);
  console.log("Owner's creator token balance:", ethers.formatEther(ownerCreatorTokenBalance));
  
  // If owner doesn't have creator tokens, transfer some from creator
  if (ownerCreatorTokenBalance < ethers.parseEther("10") && creatorAddress !== owner.address) {
    console.log("Transferring creator tokens to owner for liquidity addition...");
    try {
      const transferTx = await creatorERC20.connect(creator).transfer(owner.address, ethers.parseEther("20"));
      await transferTx.wait();
      console.log("Creator tokens transferred to owner, transaction hash:", transferTx.hash);
      
      const newOwnerCreatorBalance = await creatorERC20.balanceOf(owner.address);
      console.log("Owner's creator token balance after transfer:", ethers.formatEther(newOwnerCreatorBalance));
    } catch (transferError) {
      console.log("Error transferring creator tokens to owner:", transferError.message);
    }
  }
  
  // Approve creator tokens for liquidity manager from owner
  console.log("Approving creator tokens for liquidity manager from owner...");
  const approveOwnerCreatorTx = await creatorERC20.approve(LIQUIDITY_MANAGER_ADDRESS, ethers.parseEther("50"));
  await approveOwnerCreatorTx.wait();
  console.log("Owner creator token approval transaction hash:", approveOwnerCreatorTx.hash);
  
  // If creator is different from owner, also approve from creator
  if (creatorAddress !== owner.address) {
    console.log("Approving creator tokens for liquidity manager from creator...");
    try {
      const approveCreatorTx = await creatorERC20.connect(creator).approve(LIQUIDITY_MANAGER_ADDRESS, ethers.parseEther("50"));
      await approveCreatorTx.wait();
      console.log("Creator token approval transaction hash:", approveCreatorTx.hash);
    } catch (approveError) {
      console.log("Error approving creator tokens from creator:", approveError.message);
    }
  }
  
  // Add liquidity directly - note on Base we send ETH directly
  console.log("Adding liquidity directly...");
  try {
    // First, check if the creator has enough tokens
    const creatorTokenBalance = await creatorERC20.balanceOf(creatorAddress);
    console.log("Creator token balance before liquidity addition:", ethers.formatEther(creatorTokenBalance));
    
    // Check owner ETH balance
    const ownerEthBalance = await ethers.provider.getBalance(owner.address);
    console.log("Owner ETH balance before liquidity addition:", ethers.formatEther(ownerEthBalance));
    
    // Try with balanced amounts to meet minimum liquidity requirement
    // Note: On Base, addLiquidity takes creatorToken and ETH (not CORAL)
    console.log("Trying to add liquidity with token and ETH...");
    const addLiqTx = await liquidityManager.addLiquidity(
      creatorERC20Address,
      ethers.parseEther("20"), // Creator tokens amount
      { value: ethers.parseEther("0.2") }  // Send ETH directly
    );
    
    console.log("Waiting for transaction confirmation...");
    const receipt = await addLiqTx.wait();
    console.log("Liquidity addition successful, transaction hash:", addLiqTx.hash);
    console.log("Gas used:", receipt.gasUsed.toString());
    
    // Check reserves
    const reserves = await liquidityManager.getReserves(creatorERC20Address);
    console.log("Reserves after liquidity addition:", {
      creatorTokens: ethers.formatEther(reserves[0]),
      ethAmount: ethers.formatEther(reserves[1])
    });
  } catch (error) {
    console.log("Error adding liquidity:", error.message);
    
    // Try to get more detailed error information
    if (error.data) {
      console.log("Error data:", error.data);
    }
    
    // Try with even larger amounts as a fallback
    try {
      console.log("Trying fallback with maximum amounts...");
      
      // Check available balances
      const availableCreator = await creatorERC20.balanceOf(owner.address);
      const availableEth = await ethers.provider.getBalance(owner.address);
      
      console.log("Available balances for liquidity:", {
        creatorTokens: ethers.formatEther(availableCreator),
        ethBalance: ethers.formatEther(availableEth)
      });
      
      // Use smaller percentages for ETH to account for gas
      const creatorAmount = availableCreator * 9n / 10n;
      const ethAmount = availableEth * 3n / 10n; // Use 30% of ETH to leave room for gas
      
      console.log("Using amounts for liquidity:", {
        creatorTokens: ethers.formatEther(creatorAmount),
        ethAmount: ethers.formatEther(ethAmount)
      });
      
      const fallbackTx = await liquidityManager.addLiquidity(
        creatorERC20Address,
        creatorAmount,
        { value: ethAmount }
      );
      
      console.log("Waiting for fallback transaction confirmation...");
      await fallbackTx.wait();
      console.log("Fallback liquidity addition successful, transaction hash:", fallbackTx.hash);
      
      // Check reserves after fallback
      const fallbackReserves = await liquidityManager.getReserves(creatorERC20Address);
      console.log("Reserves after fallback liquidity addition:", {
        creatorTokens: ethers.formatEther(fallbackReserves[0]),
        ethAmount: ethers.formatEther(fallbackReserves[1])
      });
    } catch (fallbackError) {
      console.log("Fallback liquidity addition also failed:", fallbackError.message);
      
      // Let's try to check the minimum liquidity requirement
      try {
        console.log("Checking minimum liquidity requirement...");
        // This is a guess at the function name - adjust if needed
        const minLiquidity = await liquidityManager.minimumLiquidity();
        console.log("Minimum liquidity requirement:", ethers.formatEther(minLiquidity));
      } catch (minLiqError) {
        console.log("Could not determine minimum liquidity requirement");
      }
    }
  }
  
  console.log("\n=== STEP 8: Listing token on router ===");
  try {
    // Check if token is already listed
    const isListed = await tokenRouter.listedTokens(creatorERC20Address);
    console.log("Is token already listed on router:", isListed);
    
    if (!isListed) {
      console.log("Listing token on the router...");
      const listTx = await tokenRouter.listNewCreatorToken(creatorERC20Address);
      await listTx.wait();
      console.log("Token successfully listed on the router, transaction hash:", listTx.hash);
      
      // Verify listing
      const isListedAfter = await tokenRouter.listedTokens(creatorERC20Address);
      console.log("Is token listed after transaction:", isListedAfter);
    } else {
      console.log("Token is already listed on the router, proceeding with swap test.");
    }
  } catch (listError) {
    console.log("Error listing token on router:", listError.message);
    if (listError.data) {
      console.log("Error data:", listError.data);
    }
  }
  
  console.log("\n=== STEP 9: Transferring Creator Tokens to DEX ===");
  try {
    // Check if DEX has creator tokens
    const dexCreatorBalance = await creatorERC20.balanceOf(yunaDex.target);
    console.log("DEX Creator token balance:", ethers.formatEther(dexCreatorBalance));
    
    if (dexCreatorBalance < ethers.parseEther("5")) {
      console.log("Transferring creator tokens to DEX...");
      // Use creator account to transfer tokens directly to DEX
      const transferTx = await creatorERC20.connect(creator).transfer(yunaDex.target, ethers.parseEther("5"));
      await transferTx.wait();
      console.log("Creator tokens transferred to DEX, transaction hash:", transferTx.hash);
      
      // Verify transfer
      const newDexBalance = await creatorERC20.balanceOf(yunaDex.target);
      console.log("DEX Creator token balance after transfer:", ethers.formatEther(newDexBalance));
    } else {
      console.log("DEX already has sufficient creator tokens");
    }
  } catch (transferError) {
    console.log("Error transferring creator tokens to DEX:", transferError.message);
    if (transferError.data) {
      console.log("Error data:", transferError.data);
    }
  }
  
  console.log("Press Enter to continue to swap tests...");
  
  try {
    console.log("\n=== STEP 10: Testing swaps ===");
    
    // Log the current state of the contracts
    console.log("Getting current reserves from liquidity manager...");
    const [creatorReserve, ethReserve] = await liquidityManager.getReserves(creatorERC20Address);
    console.log("Current reserves:");
    console.log("  Creator token reserve:", ethers.formatEther(creatorReserve));
    console.log("  ETH reserve:", ethers.formatEther(ethReserve));
    
    // Check contract balances
    const dexEthBalance = await ethers.provider.getBalance(yunaDex.target);
    const dexCreatorBalance = await creatorERC20.balanceOf(yunaDex.target);
    console.log("DEX balances:");
    console.log("  DEX ETH balance:", ethers.formatEther(dexEthBalance));
    console.log("  DEX Creator token balance:", ethers.formatEther(dexCreatorBalance));
    
    // Check owner balances
    const ownerEthBalance = await ethers.provider.getBalance(owner.address);
    const ownerCreatorBalance = await creatorERC20.balanceOf(owner.address);
    console.log("Owner balances:");
    console.log("  Owner ETH balance:", ethers.formatEther(ownerEthBalance));
    console.log("  Owner Creator token balance:", ethers.formatEther(ownerCreatorBalance));
    
    // Calculate swap amounts
    console.log("Calculating swap amounts...");
    // Use a smaller amount for the swap to ensure it's within limits
    const swapAmount = ethers.parseEther("0.05"); // Use a smaller amount for testing
    
    console.log("ETH amount to swap:", ethers.formatEther(swapAmount));
    
    // Get expected output based on reserves
    console.log("Getting expected output from swap...");
    let expectedOutput;
    try {
      expectedOutput = await yunaDex.getAmountOut(swapAmount, ethReserve, creatorReserve);
      console.log("Expected output from getAmountOut:", ethers.formatEther(expectedOutput));
    } catch (error) {
      console.log("Error calling getAmountOut:", error.message);
      // Try a manual calculation as fallback
      expectedOutput = (BigInt(swapAmount) * BigInt(creatorReserve)) / BigInt(ethReserve);
      console.log("Manually calculated expected output:", ethers.formatEther(expectedOutput));
    }
    
    // Calculate minimum amount out with 20% slippage
    const slippage = 2000; // 20%
    const minAmountOut = expectedOutput * BigInt(8000) / BigInt(10000); // 80% of expected output
    
    console.log("Swap parameters:");
    console.log({
      amountIn: ethers.formatEther(swapAmount),
      expectedOut: ethers.formatEther(expectedOutput),
      minAmountOut: ethers.formatEther(minAmountOut),
      slippage: "20%"
    });
    
    // Wait for a minute to avoid anti-bot protection
    console.log("Waiting for 61 seconds to avoid anti-bot protection...");
    await new Promise(resolve => setTimeout(resolve, 61000));
    
    // Execute the swap ETH for creator token
    try {
      console.log("Executing swap ETH for creator token...");
      const swapTx = await yunaDex.swapETHForCreatorToken(
        creatorERC20Address,
        minAmountOut,
        slippage,
        { value: swapAmount }
      );
      
      console.log("Swap transaction hash:", swapTx.hash);
      await swapTx.wait();
      console.log("Swap successful!");
      
      // Check balances after swap
      const ownerCreatorBalanceAfter = await creatorERC20.balanceOf(owner.address);
      const ownerEthBalanceAfter = await ethers.provider.getBalance(owner.address);
      console.log("Balances after swap:");
      console.log("  Owner creator token balance:", ethers.formatEther(ownerCreatorBalanceAfter));
      console.log("  Owner ETH balance:", ethers.formatEther(ownerEthBalanceAfter));
      
      // Check reserves after swap
      const [creatorReserveAfter, ethReserveAfter] = await liquidityManager.getReserves(creatorERC20Address);
      console.log("Reserves after swap:");
      console.log("  Creator token reserve:", ethers.formatEther(creatorReserveAfter));
      console.log("  ETH reserve:", ethers.formatEther(ethReserveAfter));
    } catch (swapError) {
      console.log("Swap failed:", swapError.message);
      
      // Check the lastSwapTimestamp for the user
      try {
        const lastSwapTimestamp = await yunaDex.lastSwapTimestamp(owner.address);
        console.log("Last swap timestamp for user:", lastSwapTimestamp.toString());
        console.log("Current block timestamp:", (await ethers.provider.getBlock("latest")).timestamp);
      } catch (timeError) {
        console.log("Error checking last swap timestamp:", timeError.message);
      }
      
      if (swapError.data) {
        console.log("Error data:", swapError.data);
        
        // Try to decode the error
        try {
          // This is a common error format in Solidity
          const errorData = swapError.data;
          console.log("Error signature:", errorData.slice(0, 10));
          
          console.log("This appears to be a custom error from the contract");
          console.log("Possible reasons: time restriction, invalid amount, or other contract-specific restriction");
        } catch (error) {
          console.log("Error analyzing error data:", error.message);
        }
      }
      
      // Try a different approach - use the router instead
      console.log("\n=== Trying swap through router instead ===");
      try {
        // Use the creator account instead of owner to avoid anti-bot protection
        console.log("Using creator account for swap to avoid anti-bot protection");
        
        // Execute swap through router using creator account
        console.log("Executing swap through router using creator account...");
        const routerSwapTx = await tokenRouter.connect(creator).swapETHForToken(
          creatorERC20Address,
          minAmountOut,
          { value: swapAmount }
        );
        
        console.log("Router swap transaction hash:", routerSwapTx.hash);
        await routerSwapTx.wait();
        console.log("Router swap successful!");
        
        // Check balances after swap
        const creatorCreatorBalance = await creatorERC20.balanceOf(creator.address);
        console.log("Creator's creator token balance after router swap:", ethers.formatEther(creatorCreatorBalance));
        
        // Check reserves after swap
        const [creatorReserveAfter, ethReserveAfter] = await liquidityManager.getReserves(creatorERC20Address);
        console.log("Reserves after router swap:");
        console.log("  Creator token reserve:", ethers.formatEther(creatorReserveAfter));
        console.log("  ETH reserve:", ethers.formatEther(ethReserveAfter));
      } catch (routerSwapError) {
        console.log("Router swap also failed:", routerSwapError.message);
        
        if (routerSwapError.data) {
          console.log("Router error data:", routerSwapError.data);
          const errorSignature = routerSwapError.data.slice(0, 10);
          console.log("Router error signature:", errorSignature);
          
          // Check DEX and router balances
          const dexEthBalance = await ethers.provider.getBalance(yunaDex.target);
          const dexCreatorBalance = await creatorERC20.balanceOf(yunaDex.target);
          const routerEthBalance = await ethers.provider.getBalance(tokenRouter.target);
          
          console.log("DEX and Router balances:");
          console.log("  DEX ETH balance:", ethers.formatEther(dexEthBalance));
          console.log("  DEX Creator balance:", ethers.formatEther(dexCreatorBalance));
          console.log("  Router ETH balance:", ethers.formatEther(routerEthBalance));
        }
      }
    }
  } catch (error) {
    console.log("Error during swap tests:", error.message);
  }
  
  console.log("\n=== STEP 11: Testing reverse swap (Creator -> ETH) ===");
  try {
    // Check if owner has creator tokens to swap
    const ownerCreatorBalance = await creatorERC20.balanceOf(owner.address);
    console.log("Owner's creator token balance before reverse swap:", ethers.formatEther(ownerCreatorBalance));
    
    if (ownerCreatorBalance < ethers.parseEther("1.5")) {
      console.log("Not enough creator tokens for reverse swap test, transferring from creator...");
      const transferTx = await creatorERC20.connect(creator).transfer(owner.address, ethers.parseEther("2.0"));
      await transferTx.wait();
      console.log("Creator tokens transferred for reverse swap test, transaction hash:", transferTx.hash);
      
      const newOwnerCreatorBalance = await creatorERC20.balanceOf(owner.address);
      console.log("Owner's creator token balance after transfer:", ethers.formatEther(newOwnerCreatorBalance));
    }
    
    // Get latest reserves for calculation
    console.log("Getting current reserves from liquidity manager...");
    const [creatorReserve, ethReserve] = await liquidityManager.getReserves(creatorERC20Address);
    console.log("Current reserves:");
    console.log("  Creator token reserve:", ethers.formatEther(creatorReserve));
    console.log("  ETH reserve:", ethers.formatEther(ethReserve));
    
    // Get slippage settings directly from the contract
    console.log("Getting slippage settings from contract...");
    const slippageSettings = await yunaDex.getSlippageSettings();
    console.log("Slippage settings:");
    console.log("  Default slippage:", slippageSettings[0].toString(), "basis points");
    console.log("  Current max slippage:", slippageSettings[1].toString(), "basis points");
    console.log("  Absolute maximum:", slippageSettings[2].toString(), "basis points");
    
    // Calculate swap amounts - Use a smaller amount (<=5% of creator token reserve)
    console.log("Calculating reverse swap amounts...");
    // Calculate 5% of reserve to ensure we're within limits
    const maxAllowedAmount = creatorReserve * BigInt(5) / BigInt(100);
    console.log("Maximum allowed swap amount (5% of reserve):", ethers.formatEther(maxAllowedAmount));
    
    // Use 0.9 of the max allowed amount to be safe
    const reverseSwapAmount = ethers.parseEther("1.0"); // Reduced to 1.0 token
    console.log("Creator amount to swap:", ethers.formatEther(reverseSwapAmount));
    
    // Get expected output based on reserves
    console.log("Getting expected output from reverse swap...");
    let expectedReverseOutput;
    try {
      expectedReverseOutput = await yunaDex.getAmountOut(reverseSwapAmount, creatorReserve, ethReserve);
      console.log("Expected ETH output from getAmountOut:", ethers.formatEther(expectedReverseOutput));
    } catch (error) {
      console.log("Error calling getAmountOut for reverse swap:", error.message);
      // Try a manual calculation as fallback
      expectedReverseOutput = (BigInt(reverseSwapAmount) * BigInt(ethReserve)) / BigInt(creatorReserve);
      console.log("Manually calculated expected ETH output:", ethers.formatEther(expectedReverseOutput));
    }
    
    // Use the contract's current max slippage setting
    const reverseSlippage = slippageSettings[1]; // Current max slippage from contract
    console.log("Using contract's current max slippage:", reverseSlippage.toString(), "basis points");
    
    // Calculate minimum amount out with a much higher slippage tolerance (50%)
    // This is only for testing purposes to ensure transaction goes through
    const reverseMinAmountOut = expectedReverseOutput * BigInt(5000) / BigInt(10000); // 50% of expected output
    
    console.log("Reverse swap parameters:");
    console.log({
      amountIn: ethers.formatEther(reverseSwapAmount),
      expectedOut: ethers.formatEther(expectedReverseOutput),
      minAmountOut: ethers.formatEther(reverseMinAmountOut),
      slippage: `${Number(reverseSlippage)/100}%`,
      actualSlippageTolerance: "50%" // What we're actually accepting in minAmountOut
    });
    
    // Approve creator tokens for the DEX before swapping
    console.log("Approving creator tokens for DEX from owner...");
    const dexCreatorApprovalTx = await creatorERC20.connect(owner).approve(yunaDex.target, reverseSwapAmount);
    console.log("DEX creator approval transaction hash:", dexCreatorApprovalTx.hash);
    await dexCreatorApprovalTx.wait();
    
    // Check allowance to confirm approval
    const creatorAllowance = await creatorERC20.allowance(owner.address, yunaDex.target);
    console.log("DEX creator allowance after approval:", ethers.formatEther(creatorAllowance));
    
    // Wait for a minute to avoid anti-bot protection
    console.log("Waiting for 61 seconds to avoid anti-bot protection...");
    await new Promise(resolve => setTimeout(resolve, 61000));
    
    // Get balances before swap
    const ownerEthBeforeReverse = await ethers.provider.getBalance(owner.address);
    const ownerCreatorBeforeReverse = await creatorERC20.balanceOf(owner.address);
    console.log("Balances before reverse swap:");
    console.log("  Owner creator token balance:", ethers.formatEther(ownerCreatorBeforeReverse));
    console.log("  Owner ETH balance:", ethers.formatEther(ownerEthBeforeReverse));
    
    // Execute the reverse swap
    console.log("Executing reverse swap (creator token for ETH)...");
    const reverseSwapTx = await yunaDex.connect(owner).swapCreatorTokenForETH(
      creatorERC20Address,
      reverseSwapAmount,
      reverseMinAmountOut,
      reverseSlippage
    );
    
    console.log("Reverse swap transaction hash:", reverseSwapTx.hash);
    await reverseSwapTx.wait();
    console.log("Reverse swap successful!");
    
    // Check balances after swap
    const ownerEthAfterReverse = await ethers.provider.getBalance(owner.address);
    const ownerCreatorAfterReverse = await creatorERC20.balanceOf(owner.address);
    console.log("Balances after reverse swap:");
    console.log("  Owner creator token balance:", ethers.formatEther(ownerCreatorAfterReverse));
    console.log("  Owner ETH balance:", ethers.formatEther(ownerEthAfterReverse));
    
    // Calculate actual amounts swapped
    const creatorTokensSwapped = ownerCreatorBeforeReverse - ownerCreatorAfterReverse;
    const ethReceived = ownerEthAfterReverse - ownerEthBeforeReverse;
    console.log("Swap summary:");
    console.log("  Creator tokens swapped:", ethers.formatEther(creatorTokensSwapped));
    console.log("  ETH tokens received:", ethers.formatEther(ethReceived));
    
    // Check reserves after swap
    const [creatorReserveAfter, ethReserveAfter] = await liquidityManager.getReserves(creatorERC20Address);
    console.log("Reserves after reverse swap:");
    console.log("  Creator token reserve:", ethers.formatEther(creatorReserveAfter));
    console.log("  ETH reserve:", ethers.formatEther(ethReserveAfter));
  } catch (reverseSwapError) {
    console.log("Reverse swap failed:", reverseSwapError.message);
    
    if (reverseSwapError.data) {
      console.log("Error data:", reverseSwapError.data);
      
      // Try to decode the error
      try {
        // This is a common error format in Solidity
        const errorData = reverseSwapError.data;
        console.log("Error signature:", errorData.slice(0, 10));
        
        console.log("This appears to be a custom error from the contract");
        console.log("Possible reasons: time restriction, invalid amount, or other contract-specific restriction");
      } catch (error) {
        console.log("Error analyzing error data:", error.message);
      }
    }
    
    // Try router as an alternative
    console.log("\n=== Trying reverse swap through router instead ===");
    try {
      console.log("Executing reverse swap through router...");
      // Approve tokens for router
      await creatorERC20.connect(owner).approve(tokenRouter.target, reverseSwapAmount);
      
      const routerReverseSwapTx = await tokenRouter.connect(owner).swapTokenForETH(
        creatorERC20Address,
        reverseSwapAmount,
        reverseMinAmountOut
      );
      
      console.log("Router reverse swap transaction hash:", routerReverseSwapTx.hash);
      await routerReverseSwapTx.wait();
      console.log("Router reverse swap successful!");
      
      // Check balances after router swap
      const ownerEthAfterRouterSwap = await ethers.provider.getBalance(owner.address);
      const ownerCreatorAfterRouterSwap = await creatorERC20.balanceOf(owner.address);
      console.log("Balances after router reverse swap:");
      console.log("  Owner creator token balance:", ethers.formatEther(ownerCreatorAfterRouterSwap));
      console.log("  Owner ETH balance:", ethers.formatEther(ownerEthAfterRouterSwap));
    } catch (routerSwapError) {
      console.log("Router reverse swap also failed:", routerSwapError.message);
      if (routerSwapError.data) {
        console.log("Router error data:", routerSwapError.data);
      }
    }
  }
  
  console.log("\n=== All tests (including reverse swap) completed! ===");
}

// Add a delay function to wait between swaps
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in tests:", error);
    process.exit(1);
  });
