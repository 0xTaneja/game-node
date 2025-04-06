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

// Add isDryRun property to the Twitter client
(twitterClient as any).isDryRun = isDryRun;

// Create Twitter plugin with the proper client
const twitterPlugin = new TwitterPlugin({
    id: "twitter_worker",
    name: "Twitter Worker",
    description: "A worker for posting YouTube updates to Twitter",
    twitterClient: twitterClient
});

// Configure Twitter to actually send tweets unless TWITTER_DRY_RUN=true
if (isDryRun) {
  console.log('Twitter in DRY RUN mode - tweets will be logged but not sent');
} else {
  console.log('Twitter in LIVE mode - tweets will be sent to Twitter API');
  console.log(`Twitter client configured with isDryRun=${isDryRun}`);
}

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
export const youtube_agent = new GameAgent(process.env.API_KEY, {
    name: "YouTube Trend Monitor",
    goal: "Autonomously discover, track, and analyze YouTube creators and their metrics to identify trends, measure growth patterns, and share insights through automated Twitter updates",
    description: `This autonomous agent continuously monitors the YouTube ecosystem by:

1. Discovering trending creators across multiple content categories
2. Tracking key metrics including subscribers, views, likes, and engagement
3. Analyzing growth patterns with adaptive thresholds based on channel size
4. Detecting significant metric changes that indicate important trends
5. Automatically posting updates to Twitter when notable events are detected
6. Using multiple API keys with automatic failover when rate limits are reached
7. Maintaining persistent state for long-term trend analysis

The agent operates 24/7 to provide real-time insights into the YouTube creator landscape without manual intervention.`,
    workers: [youtubeMonitorWorker],
    llmModel: LLMModel.DeepSeek_R1,
    getAgentState: getAgentState
});

// Set up logging for the agent
youtube_agent.setLogger((agent: GameAgent, msg: string) => {
    console.log(`📺 [${agent.name}]`);
    console.log(msg);
    console.log("------------------------\n");
});

// Start the agent
(async () => {
    try {
        // Log startup information
        console.log("-----------------------------");
        console.log("🚀 Starting YouTube Monitor Agent");
        console.log(`Using ${youtubeApiKeys.length} YouTube API keys with automatic rate limit handling`);
        console.log(`API keys will rotate automatically when quota limits are reached`);
        console.log(`Using Twitter Access Token: ${process.env.TWITTER_ACCESS_TOKEN?.substring(0, 10)}...`);
        console.log(`Database: ${process.env.MONGODB_URI}`);
        console.log(`Twitter Posting: ${isDryRun ? 'DRY RUN (disabled)' : 'LIVE (enabled)'}`);
        console.log("-----------------------------");
        
        await youtube_agent.init();
        console.log("YouTube monitoring agent initialized successfully");
        
        // Start monitoring automatically - this will use the actual YouTube API and Twitter
        youtubePlugin.startMonitoring();
        console.log("YouTube monitoring started");
        
        // Update agent state to reflect monitoring status
        updateAgentState({ isMonitoring: true });
        
        // Run the agent in continuous mode
        while (true) {
            await youtube_agent.step({
                verbose: true,
            });
            // Sleep to avoid excessive API calls
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
        }
    } catch (error) {
        console.error("Error starting agent:", error);
    }
})();