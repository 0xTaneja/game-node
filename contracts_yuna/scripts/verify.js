const hre = require("hardhat");
const deploymentInfo = require('./deployment-info.json');

async function main() {
  console.log("Starting contract verification...");

  try {
    await hre.run("verify:verify", {
      address: deploymentInfo.implementation,
      constructorArguments: []
    });
    
    console.log("Verification successful!");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 