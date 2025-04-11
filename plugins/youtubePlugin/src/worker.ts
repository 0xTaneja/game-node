import { GameWorker, GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import * as storage from "../db/storage";
import { youtubePlugin } from "./agent"; // Import the shared plugin instance

// This is the worker that will be passed to the agent
export const youtubeMonitorWorker = new GameWorker({
    id: "youtube_monitor",
    name: "YouTube Monitor Worker",
    description: "A worker that monitors YouTube channels, identifies trends, and tracks creator metrics",
    getEnvironment: async () => {
        try {
            // Get minimal stats to reduce payload size
            const channelCount = await storage.getChannelCount();
            const isDryRun = process.env.TWITTER_DRY_RUN === 'true';
            
            // Return minimal data to avoid large payloads
            return {
                CHANNELS: channelCount.toString(),
                MONITORING: youtubePlugin ? "ON" : "OFF",
                MODE: isDryRun ? "DRY" : "LIVE",
                UPDATED: new Date().toISOString().split('T')[0]
            };
        } catch (error) {
            console.error("Error getting environment:", error);
            return { ERROR: "Failed to get data" };
        }
    },
    functions: [
        // Track YouTube channel
        new GameFunction({
            name: "track_youtube_channel",
            description: "Track a YouTube channel to monitor its metrics and get updates about new videos and significant changes",
            args: [
                { name: "channelId", description: "The YouTube channel ID to track" }
            ] as const,
            executable: async (args, logger) => {
                try {
                    if (!args.channelId) {
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            "Channel ID is required"
                        );
                    }

                    logger(`Tracking YouTube channel: ${args.channelId}`);
                    
                    // Use the youtubePlugin's trackChannelFunction directly
                    const result = await youtubePlugin.trackChannelFunction.executable({
                        channel_id: args.channelId
                    }, logger);
                    
                    return result;
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to track YouTube channel: ${errorMessage}`
                    );
                }
            }
        }),
        
        // Get trending creators
        new GameFunction({
            name: "get_trending_creators",
            description: "Get a list of trending YouTube creators based on engagement scores",
            args: [
                { name: "count", description: "Number of trending creators to return (default: 5)" }
            ] as const,
            executable: async (args, logger) => {
                try {
                    // Convert count to number with default value of 5
                    const count = args.count ? Number(args.count) : 5;
                    
                    // Validate that count is a positive number
                    if (isNaN(count) || count <= 0) {
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            "Count must be a positive number"
                        );
                    }
                    
                    logger(`Getting top ${count} trending YouTube creators`);

                    // Use the shared youtubePlugin - need to use getTrackedChannelsFunction
                    // which will return all the tracked channels, we can then use the most recently trending ones
                    const result = await youtubePlugin.getTrackedChannelsFunction.executable({}, logger);
                    
                    return result;
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to get trending creators: ${errorMessage}`
                    );
                }
            }
        }),
        
        // Start YouTube monitoring
        new GameFunction({
            name: "start_youtube_monitoring",
            description: "Start the YouTube monitoring system to automatically track metrics and detect trends",
            args: [] as const,
            executable: async (_, logger) => {
                try {
                    logger("Starting YouTube monitoring system");
                    
                    // Use the shared youtubePlugin to start monitoring
                    youtubePlugin.startMonitoring();
                    
                    logger("Monitoring system is now active");

                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Done,
                        "YouTube monitoring started successfully"
                    );
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to start YouTube monitoring: ${errorMessage}`
                    );
                }
            }
        }),
        
        // Stop YouTube monitoring
        new GameFunction({
            name: "stop_youtube_monitoring",
            description: "Stop the YouTube monitoring system",
            args: [] as const,
            executable: async (_, logger) => {
                try {
                    logger("Stopping YouTube monitoring system");
                    
                    // Use the shared youtubePlugin to stop monitoring
                    youtubePlugin.stopMonitoring();
                    
                    logger("Monitoring system has been stopped");

                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Done,
                        "YouTube monitoring stopped successfully"
                    );
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to stop YouTube monitoring: ${errorMessage}`
                    );
                }
            }
        }),
        
        // Get channel metrics
        new GameFunction({
            name: "get_channel_metrics",
            description: "Get metrics for a specific YouTube channel",
            args: [
                { name: "channelId", description: "The YouTube channel ID" }
            ] as const,
            executable: async (args, logger) => {
                try {
                    if (!args.channelId) {
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            "Channel ID is required"
                        );
                    }

                    logger(`Getting metrics for YouTube channel: ${args.channelId}`);
                    
                    // Use the shared youtubePlugin to get metrics
                    const result = await youtubePlugin.getChannelMetricsFunction.executable({
                        channel_id: args.channelId
                    }, logger);
                    
                    return result;
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to get channel metrics: ${errorMessage}`
                    );
                }
            }
        }),
        
        // Post update to Twitter
        new GameFunction({
            name: "post_youtube_update",
            description: "Post an update about a YouTube channel to Twitter",
            args: [
                { name: "channelId", description: "The YouTube channel ID" },
                { name: "message", description: "The message to post on Twitter" }
            ] as const,
            executable: async (args, logger) => {
                try {
                    if (!args.channelId || !args.message) {
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            "Channel ID and message are required"
                        );
                    }

                    logger(`Posting update about YouTube channel ${args.channelId}: ${args.message}`);
                    
                    // Verify the channel exists
                    const channel = await storage.getChannel(args.channelId);
                    if (!channel) {
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            `Channel with ID ${args.channelId} is not being tracked`
                        );
                    }
                    
                    // Use the youtubePlugin's postTweet method directly
                    const success = await youtubePlugin.postTweet(
                        args.message,
                        `Update about YouTube channel: ${channel.name}`
                    );
                    
                    if (success) {
                        logger(`Tweet about ${channel.name} has been posted successfully`);
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Done,
                            `Posted update about ${channel.name} to Twitter`
                        );
                    } else {
                        logger(`Failed to post tweet about ${channel.name}`);
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Failed,
                            `Failed to post update about ${channel.name} to Twitter`
                        );
                    }
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to post update: ${errorMessage}`
                    );
                }
            }
        })
    ]
});

// Add direct tweet function for maximum compatibility
youtubeMonitorWorker.functions.push(
    new GameFunction({
        name: "tweet",
        description: "Post a tweet directly to Twitter",
        args: [
            { name: "message", description: "The content of the tweet" }
        ] as const,
        executable: async (args, logger) => {
            try {
                if (!args.message) {
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        "Tweet content is required"
                    );
                }

                logger(`Posting tweet: ${args.message.substring(0, 50)}...`);
                
                try {
                    // Use youtubePlugin's postTweet method which is safer
                    const success = await youtubePlugin.postTweet(
                        args.message,
                        "Direct tweet request"
                    );
                    
                    if (success) {
                        logger("Tweet posted successfully!");
                        return new ExecutableGameFunctionResponse(
                            ExecutableGameFunctionStatus.Done,
                            "Tweet posted successfully"
                        );
                    } else {
                        throw new Error("Failed to post tweet using plugin method");
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Failed to post tweet: ${errorMessage}`
                    );
                }
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `Failed to post tweet: ${errorMessage}`
                );
            }
        }
    })
);