import { GameAgent, LLMModel } from "@virtuals-protocol/game";
import dotenv from "dotenv";
import { youtubeClient } from "./youtubeClient";
import { YoutubePlugin } from "./youtubePlugin";
import { youtubeMonitorWorker } from "./worker";
import TwitterPlugin from "../../twitterPlugin/src/twitterPlugin";
import { GameTwitterClient } from "../../twitterPlugin/src/gameTwitterClient";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// State management for the agent
interface AgentState {
  trackedChannels: number;
  monitoringSince: string;
  lastTrendingUpdate: string;
  topCreators: string[];
  totalTweets: number;
  isMonitoring: boolean;
}

// Initialize agent state
let agentState: AgentState = {
  trackedChannels: 0,
  monitoringSince: new Date().toISOString(),
  lastTrendingUpdate: new Date().toISOString(),
  topCreators: [],
  totalTweets: 0,
  isMonitoring: false
};

// Function to get agent state
export const getAgentState = async (): Promise<AgentState> => {
  return agentState;
};

// Function to update agent state
export const updateAgentState = (newState: Partial<AgentState>): void => {
  agentState = { ...agentState, ...newState };
  console.log("Agent state updated:", agentState);
};

// Verify required environment variables
if (!process.env.API_KEY || !process.env.TWITTER_ACCESS_TOKEN) {
    throw new Error("API_KEY and TWITTER_ACCESS_TOKEN are required in environment variables");
}

// Collect all YouTube API keys from environment variables
const youtubeApiKeys = [
    process.env.YOUTUBE_API_KEY1,
    process.env.YOUTUBE_API_KEY2, 
    process.env.YOUTUBE_API_KEY3
].filter(Boolean) as string[];

// Ensure we have at least one YouTube API key
if (youtubeApiKeys.length === 0) {
    throw new Error("At least one YouTube API key (YOUTUBE_API_KEY1, YOUTUBE_API_KEY2, or YOUTUBE_API_KEY3) is required");
}

console.log(`Found ${youtubeApiKeys.length} YouTube API keys for rotation`);

// Initialize YouTube client with multiple API keys for automatic rotation when rate limits are encountered
// The client will automatically switch to the next key if the current one hits quota limits
const ytClient = new youtubeClient(youtubeApiKeys);

// Determine if Twitter should run in dry run mode (no actual posting)
const isDryRun = process.env.TWITTER_DRY_RUN === 'true';

// Create the Twitter client with the access token
const twitterClient = new GameTwitterClient({
    accessToken: process.env.TWITTER_ACCESS_TOKEN
});

// Create Twitter plugin with the proper client
const twitterPlugin = new TwitterPlugin({
    id: "twitter_worker",
    name: "Twitter Worker",
    description: "A worker for posting YouTube updates to Twitter",
    twitterClient: twitterClient
});

// Diagnostic function to verify the Twitter plugin configuration
function diagnoseTwitterPlugin() {
    console.log("---- Twitter Plugin Diagnostic ----");
    
    // Check if the plugin instance exists
    if (!twitterPlugin) {
        console.error("Twitter plugin is null or undefined!");
        return;
    }
    
    // Check if essential methods exist
    console.log("Twitter plugin methods available:");
    console.log("- postTweetFunction exists:", !!twitterPlugin.postTweetFunction);
    
    // Check if twitterClient is accessible
    try {
        // Use type assertion to check private property
        const client = (twitterPlugin as any).twitterClient;
        console.log("- twitterClient exists:", !!client);
        console.log("- twitterClient.post exists:", !!(client && typeof client.post === 'function'));
        
        // Test accessing needed properties
        if (twitterPlugin.postTweetFunction) {
            const postFn = twitterPlugin.postTweetFunction;
            console.log("- postTweetFunction.executable exists:", !!(postFn && typeof postFn.executable === 'function'));
        }
    } catch (error) {
        console.error("Error checking Twitter plugin configuration:", error);
    }
    
    console.log("----------------------------------");
}

// Run diagnostic
diagnoseTwitterPlugin();

// Configure Twitter posting mode
if (isDryRun) {
  console.log('Twitter in DRY RUN mode - tweets will be logged but not sent');
} else {
  console.log('Twitter in LIVE mode - tweets will be sent to Twitter API');
  console.log(`Using Twitter token: ${process.env.TWITTER_ACCESS_TOKEN?.substring(0, 10)}...`);
}

// Test Twitter client connection
(async () => {
  try {
    // Try to get Twitter account info to verify connection
    const twitterInfo = await twitterClient.me();
    console.log(`Twitter client authenticated successfully: ${twitterInfo.data.username || 'Unknown username'}`);
  } catch (err: any) {
    console.warn(`Twitter authentication check: ${err.message || 'Unknown error'}`);
  }
})();

// Create the YouTube plugin with Twitter integration
// This passes the actual Twitter plugin for posting updates
const youtubePlugin = new YoutubePlugin({
    youtubeClient: ytClient,
    twitterPlugin: twitterPlugin,
    autoStartScheduler: true,
    onStateUpdate: (pluginState) => {
      // Update agent state based on plugin state
      updateAgentState({
        trackedChannels: pluginState.trackedChannels || 0,
        topCreators: pluginState.topCreators || [],
        lastTrendingUpdate: pluginState.lastTrendingUpdate || new Date().toISOString(),
        totalTweets: pluginState.totalTweets || 0,
        isMonitoring: pluginState.isMonitoring || false
      });
    }
});

// Export the youtubePlugin for use in worker.ts
export { youtubePlugin };

// Create the YouTube monitoring agent
const agent = new GameAgent(process.env.API_KEY || "", {
  name: "YouTube Community Engager",
  goal: "Monitor YouTube channels, discover trending creators, and actively engage with the community on Twitter. Search for and participate in discussions about trending creators, share insights about channel growth, and interact with relevant tweets to build community engagement. When a creator trends, find and engage with tweets about them, reply to discussions, and share growth insights.",
  description: `An autonomous agent that:
1. Monitors YouTube channels and tracks metrics
2. Discovers trending creators and analyzes their growth
3. Actively searches Twitter for discussions about trending creators
4. Engages with the community by:
   - Replying to tweets about all monitored trending creators
   - Liking relevant content about all monitored channels
   - Quoting tweets to share growth insights
   - Participating in discussions about creator success
5. Shares detailed metrics and growth analysis
6. Builds community engagement around trending creators`,
  workers: [
    youtubePlugin.getWorker({
      functions: [
        youtubePlugin.searchChannelsFunction,
        youtubePlugin.trackChannelFunction,
        youtubePlugin.getTrackedChannelsFunction,
        youtubePlugin.getChannelMetricsFunction,
        youtubePlugin.getTrendingVideosFunction,
        youtubePlugin.startMonitoringFunction,
        youtubePlugin.stopMonitoringFunction,
        youtubePlugin.tweetFunction,
        // Add Twitter functions for interaction
        ...(youtubePlugin.twitterPlugin ? [
          youtubePlugin.twitterPlugin.searchTweetsFunction,
          youtubePlugin.twitterPlugin.replyTweetFunction,
          youtubePlugin.twitterPlugin.likeTweetFunction,
          youtubePlugin.twitterPlugin.quoteTweetFunction
        ] : [])
      ],
      getEnvironment: async () => ({
        ...(await youtubePlugin.getMetrics()),
        mode: youtubePlugin.isMonitoring ? "active" : "inactive",
        updated: new Date().toISOString()
      })
    })
  ]
});

// Set up logging for the agent
agent.setLogger((agent: GameAgent, msg: string) => {
    console.log(`📺 [${agent.name}]`);
    console.log(msg);
    console.log("------------------------\n");
});

// Start the agent
(async () => {
    try {
        // Log startup information
        console.log("\n\n");
        console.log("===========================================================");
        console.log("🚀🚀🚀 STARTING YOUTUBE MONITOR SYSTEM 🚀🚀🚀");
        console.log("===========================================================");
        console.log(`Using ${youtubeApiKeys.length} YouTube API keys with automatic rate limit handling`);
        console.log(`API keys will rotate automatically when quota limits are reached`);
        console.log(`Using Twitter Access Token: ${process.env.TWITTER_ACCESS_TOKEN?.substring(0, 10)}...`);
        console.log(`Database: ${process.env.MONGODB_URI}`);
        console.log(`Twitter Posting: ${isDryRun ? 'DRY RUN (disabled)' : 'LIVE (enabled)'}`);
        console.log(`Monitoring Schedule: Trending - 24 hours, Metrics - 15 minutes`);
        console.log("===========================================================");
        
        await agent.init();
        console.log("YouTube monitoring agent initialized successfully");
        
        // Start monitoring automatically - this will use the actual YouTube API and Twitter
        youtubePlugin.startMonitoring();
        console.log("YouTube monitoring started");
        
        // Update agent state to reflect monitoring status
        updateAgentState({ isMonitoring: true });
        
        // Run the agent in continuous mode with retry logic
        console.log("Starting agent loop with resilient error handling...");
        let consecutiveErrors = 0;
        
        while (true) {
            try {
                // Execute agent step with verbose logging
                await agent.step({
                    verbose: true,
                });
                
                // Success - reset error counter and wait normal time
                consecutiveErrors = 0;
                const normalDelay = 120000; // 2 minutes
                console.log(`Agent step successful, waiting ${normalDelay/1000} seconds before next step`);
                await new Promise(resolve => setTimeout(resolve, normalDelay));
            } catch (stepError) {
                // Count consecutive errors for exponential backoff
                consecutiveErrors++;
                
                // Calculate backoff delay with more aggressive scaling
                const baseDelay = 120000; // 2 minutes base delay
                const backoffFactor = Math.min(Math.pow(3, consecutiveErrors - 1), 25); // More aggressive exponential growth (3^n)
                const backoffDelay = Math.min(baseDelay * backoffFactor, 3600000); // max 1 hour
                
                console.warn(`Agent step failed (${consecutiveErrors} consecutive errors)`);
                console.warn(`Error: ${(stepError as Error)?.message || String(stepError)}`);
                console.warn(`Will retry after ${backoffDelay/1000} seconds (${backoffDelay/60000} minutes) backoff`);
                
                // If API quota errors are detected, use maximum backoff
                const errorStr = String(stepError);
                if (errorStr.includes('quota') || errorStr.includes('403') || errorStr.includes('429')) {
                    console.warn("API quota exceeded - using maximum backoff time");
                    await new Promise(resolve => setTimeout(resolve, 3600000)); // 1 hour
                    continue;
                }
                
                // If we see a 524 error specifically
                if (errorStr.includes('524') || errorStr.includes('timeout')) {
                    console.warn("Detected connection timeout (524) - this is likely due to Game SDK rate limiting");
                    console.warn("YouTube monitoring will continue to operate normally despite this error");
                }
                
                // Wait with exponential backoff
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
    } catch (error) {
        console.error("Fatal error starting agent:", error);
        
        // Even if the agent fails completely, make sure monitoring continues
        try {
            if (!youtubePlugin.isMonitoring) {
                youtubePlugin.startMonitoring();
                console.warn("Restarted monitoring after fatal error");
            }
        } catch (monitorError) {
            console.error("Failed to ensure monitoring continues:", monitorError);
        }
    }
})();