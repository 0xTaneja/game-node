import { GameWorker,GameFunction,ExecutableGameFunctionResponse,ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { youtubeClient,YoutubeChannel,YoutubeVideo } from "./youtubeClient";
import { YoutubeScheduler } from "./youtubeScheduler";

import * as storage from "../db/storage";

import TwitterPlugin from "../../twitterPlugin/src/twitterPlugin";
import { TweetFormatter } from "./tweetFormatter";
import { AIResponseGenerator } from "./aiResponseGenerator";

// Plugin state interface
export interface PluginState {
  trackedChannels: number;
  topCreators: string[];
  lastTrendingUpdate: string;
  totalTweets: number;
  isMonitoring: boolean;
}

interface IYoutubePluginOptions {
    id?: string;
    name?: string;
    description?: string;
    youtubeClient: youtubeClient;
    twitterPlugin?: TwitterPlugin;
    autoStartScheduler?: boolean; // Option to auto-start scheduler
    onStateUpdate?: (state: PluginState) => void; // Callback for state updates
}

class YoutubePlugin {
    private id: string;
    private name: string;
    private description: string;
    private youtubeClient: youtubeClient;
    public twitterPlugin?: TwitterPlugin;
    private scheduler: YoutubeScheduler;
    private state: PluginState;
    private onStateUpdate?: (state: PluginState) => void;
    
    constructor(options: IYoutubePluginOptions) {
        this.id = options.id || "youtube_worker";
        this.name = options.name || "Youtube Worker";
        this.description = options.description || "A worker that tracks YouTube channels, analyzes trends, and monitors creator growth";
        this.youtubeClient = options.youtubeClient;
        this.twitterPlugin = options.twitterPlugin;
        this.onStateUpdate = options.onStateUpdate;

        // Initialize state
        this.state = {
          trackedChannels: 0,
          topCreators: [],
          lastTrendingUpdate: new Date().toISOString(),
          totalTweets: 0,
          isMonitoring: false
        };

        // Initialize the scheduler with Twitter plugin for posting and optional state update callback
        this.scheduler = new YoutubeScheduler(
            this.youtubeClient,
            this.twitterPlugin,
            this.onStateUpdate ? (state: Partial<PluginState>) => this.updateState(state) : undefined
        );

        // Auto-start the scheduler if specified
        if (options.autoStartScheduler) {
            this.startMonitoring();
        }
    }

    // Method to update state and notify listeners
    private updateState(newState: Partial<PluginState>): void {
        this.state = { ...this.state, ...newState };
        
        // Log state changes
        console.log("Plugin state updated:", this.state);
        
        // Notify callback if provided
        if (this.onStateUpdate) {
            this.onStateUpdate(this.state);
        }
    }

    // Method to post a tweet using the Twitter plugin
    public async postTweet(tweet: string, reason: string): Promise<boolean> {
        if (!this.twitterPlugin) {
            console.log("No Twitter plugin configured, skipping tweet:", tweet);
            return false;
        }

        try {
            console.log(`Preparing to post tweet: ${tweet.substring(0, 50)}... (${reason})`);
            
            // Get the postTweetFunction from the Twitter plugin
            const postTweetFunction = this.twitterPlugin.postTweetFunction;
            
            if (!postTweetFunction || !postTweetFunction.executable) {
                throw new Error("Twitter plugin does not have a valid post tweet function");
            }
            
            // Log the Tweet content for debugging
            console.log("Full tweet content:", tweet);
            console.log("Using Twitter plugin to post tweet");
            
            // Execute the tweet function directly
            const logger = (msg: string) => console.log(`Twitter posting: ${msg}`);
            const result = await postTweetFunction.executable({ 
                tweet: tweet, 
                tweet_reasoning: reason 
            }, logger);
            
            // Update tweet count on success
            if (result && result.status === ExecutableGameFunctionStatus.Done) {
                console.log("Tweet posted successfully!");
                this.updateState({ totalTweets: (this.state.totalTweets || 0) + 1 });
                return true;
            }
            
            console.error("Failed to post tweet:", result ? result.status : "Unknown error");
            return false;
        } catch (error: any) {
            console.error("Error posting tweet:", error.message || error);
            return false;
        }
    }

    // New method to engage with tweets about a creator
    public async engageWithCreatorTweets(creatorName: string, channelId: string): Promise<void> {
        if (!this.twitterPlugin) {
            console.log("No Twitter plugin configured, skipping tweet engagement");
            return;
        }

        try {
            console.log(`Searching for tweets about ${creatorName}`);
            
            // Search for tweets about the creator
            const searchResult = await this.twitterPlugin.searchTweetsFunction.executable(
                { query: creatorName },
                (msg: string) => console.log(`Searching tweets: ${msg}`)
            );

            if (searchResult && searchResult.status === ExecutableGameFunctionStatus.Done) {
                // Extract only the JSON part from the feedback
                // The feedback format is: "Tweets found:\n[...]"
                let feedbackString = searchResult.feedback;
                let jsonStartIndex = feedbackString.indexOf('[');
                
                if (jsonStartIndex === -1) {
                    console.log("No valid JSON found in search result");
                    return;
                }
                
                // Extract only the JSON part
                let jsonString = feedbackString.substring(jsonStartIndex);
                const tweets = JSON.parse(jsonString);
                
                // Process each tweet
                for (const tweet of tweets) {
                    // Like the tweet
                    await this.twitterPlugin.likeTweetFunction.executable(
                        { tweet_id: tweet.tweetId },
                        (msg: string) => console.log(`Liking tweet: ${msg}`)
                    );

                    // Reply with AI-generated content based on tweet context
                    const channel = await storage.getChannel(channelId);
                    if (channel) {
                        // Generate an AI-powered response that considers the tweet content and sentiment
                        const aiReply = AIResponseGenerator.generateReply(tweet.content, creatorName, channel.metrics);
                        
                        // Generate context-aware reasoning for this reply
                        const replyReasoning = AIResponseGenerator.generateReplyReasoning(tweet.content, creatorName);
                        
                        console.log(`AI-generated reply: ${aiReply}`);
                        console.log(`Reply reasoning: ${replyReasoning}`);
                        
                        await this.twitterPlugin.replyTweetFunction.executable(
                            { 
                                tweet_id: tweet.tweetId,
                                reply: aiReply,
                                reply_reasoning: replyReasoning
                            },
                            (msg: string) => console.log(`Replying to tweet: ${msg}`)
                        );
                        
                        // For some tweets, also quote them with additional insights
                        // Only quote tweets that have good engagement rates
                        // Calculate engagement rate based on likes, retweets and impressions
                        const impressions = tweet.impressions || (tweet.likes * 10 + tweet.retweets * 20); // Estimate impressions if not available
                        const engagementRate = (tweet.likes + tweet.retweets) / impressions;
                        
                        if (engagementRate > 0.02) { // Quote tweets with >2% engagement rate
                            const quoteContent = AIResponseGenerator.generateQuote(tweet.content, creatorName, channel.metrics);
                            const quoteReasoning = AIResponseGenerator.generateQuoteReasoning(tweet.content, creatorName);
                            
                            await this.twitterPlugin.quoteTweetFunction.executable(
                                {
                                    tweet_id: tweet.tweetId,
                                    quote: quoteContent
                                },
                                (msg: string) => console.log(`Quoting tweet: ${msg}`)
                            );
                            
                            console.log(`Quote reasoning: ${quoteReasoning}`);
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error("Error engaging with tweets:", error.message || error);
        }
    }

    // Helper method to format numbers
    private formatNumber(num: number): string {
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(1)}M`;
        }
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}K`;
        }
        return num.toString();
    }

    public getWorker(data?: {
        functions?: GameFunction<any>[];
        getEnvironment?: () => Promise<Record<string, any>>;
      }): GameWorker {
        // Get Twitter functions if plugin is available
        const twitterFunctions = this.twitterPlugin ? [
          this.twitterPlugin.searchTweetsFunction,
          this.twitterPlugin.replyTweetFunction,
          this.twitterPlugin.likeTweetFunction,
          this.twitterPlugin.quoteTweetFunction
        ] : [];

        return new GameWorker({
          id: this.id,
          name: this.name,
          description: this.description,
          functions: data?.functions || [
            this.searchChannelsFunction,
            this.trackChannelFunction,
            this.getTrackedChannelsFunction,
            this.getChannelMetricsFunction,
            this.getTrendingVideosFunction,
            this.startMonitoringFunction,
            this.stopMonitoringFunction,
            this.tweetFunction,
            ...twitterFunctions // Add Twitter functions
          ],
          getEnvironment: data?.getEnvironment || this.getMetrics.bind(this),
        });
      }

      public async getMetrics() {
        // Get all tracked channels
        const channels = await storage.getAllTrackedChannels();
        
        // Update state with channel count
        this.updateState({ trackedChannels: channels.length });
        
        // Calculate tier distribution
        const tier1Count = channels.filter(c => c.monitoringTier === 1).length;
        const tier2Count = channels.filter(c => c.monitoringTier === 2).length;
        const tier3Count = channels.filter(c => c.monitoringTier === 3).length;
        
        return {
          trackedChannels: channels.length,
          tier1Channels: tier1Count,
          tier2Channels: tier2Count,
          tier3Channels: tier3Count
        };
      }

      // Add methods to start/stop the scheduler
      public startMonitoring(): void {
        this.scheduler.start();
        this.updateState({ isMonitoring: true });
      }
      
      public stopMonitoring(): void {
        this.scheduler.stop();
        this.updateState({ isMonitoring: false });
      }

      // Add function to let AI start monitoring
      get startMonitoringFunction() {
        return new GameFunction({
          name: "start_youtube_monitoring",
          description: "Start the background monitoring of YouTube channels",
          args: [] as const,
          executable: async (args, logger) => {
            try {
              logger("Starting YouTube monitoring system");
              
              this.startMonitoring();
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                "YouTube monitoring started successfully"
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to start monitoring: ${errorMessage}`
              );
            }
          }
        });
      }
      
      // Add function to let AI stop monitoring
      get stopMonitoringFunction() {
        return new GameFunction({
          name: "stop_youtube_monitoring",
          description: "Stop the background monitoring of YouTube channels",
          args: [] as const,
          executable: async (args, logger) => {
            try {
              logger("Stopping YouTube channel monitoring...");
              
              this.stopMonitoring();
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                "YouTube monitoring has been stopped"
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to stop monitoring: ${errorMessage}`
              );
            }
          }
        });
      }

      get searchChannelsFunction() {
        return new GameFunction({
          name: "search_channels",
          description: "Search for YouTube channels by query",
          args: [{ 
            name: "query", 
            description: "The search query for finding channels" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.query) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Query is required"
                );
              }
      
              logger(`Searching for channels: ${args.query}`);
      
              const channels = await this.youtubeClient.searchChannels(args.query);
      
              const feedbackMessage = 
                "Channels found:\n" +
                JSON.stringify(
                  channels.map(channel => ({
                    channelId: channel.id,
                    title: channel.title,
                    subscribers: channel.statistics.subscriberCount,
                    views: channel.statistics.viewCount
                  }))
                );
      
              logger(feedbackMessage);
      
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to search channels: ${errorMessage}`
              );
            }
          },
        });
      }

      get trackChannelFunction() {
        return new GameFunction({
          name: "track_channel",
          description: "Start tracking a YouTube channel",
          args: [{ 
            name: "channel_id", 
            description: "The channel ID to track" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.channel_id) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Channel ID is required"
                );
              }
      
              logger(`Starting to track channel: ${args.channel_id}`);
      
              // First check if the channel already exists in our DB
              let channel = await storage.getChannel(args.channel_id);
              
              if (channel) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  `Channel ${channel.name} is already being tracked`
                );
              }
              
              // Fetch channel info from YouTube
              const channelInfo = await this.youtubeClient.getChannel(args.channel_id);
              
              if (!channelInfo) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Could not find channel with ID: ${args.channel_id}`
                );
              }
              
              // Get total likes as an additional metric
              const totalLikes = await this.youtubeClient.getTotalChannelLikes(args.channel_id);
              
              // Create channel in database
              const currentMetrics = {
                subscribers: channelInfo.statistics.subscriberCount,
                views: channelInfo.statistics.viewCount,
                likes: totalLikes,
                lastVideoId: '',
                lastVideoTimestamp: 0,
                lastChecked: Date.now()
              };
              
              await storage.createChannel(
                args.channel_id,
                channelInfo.title,
                currentMetrics
              );
              
              // Optionally post to Twitter
              if (this.twitterPlugin) {
                await this.twitterPlugin.postTweetFunction.executable({
                  tweet: TweetFormatter.formatTrackingAnnouncementTweet(channelInfo),
                  tweet_reasoning: "Announcing new channel tracking to followers"
                }, (message: string) => console.log(message));
              }
      
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Now tracking channel: ${channelInfo.title}`
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to track channel: ${errorMessage}`
              );
            }
          },
        });
      }
      
      // Get all tracked channels
      get getTrackedChannelsFunction() {
        return new GameFunction({
          name: "get_tracked_channels",
          description: "Get a list of all channels being tracked",
          args: [] as const,
          executable: async (args, logger) => {
            try {
              logger("Fetching all tracked channels...");
              
              const channels = await storage.getAllTrackedChannels();
              
              if (channels.length === 0) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  "No channels are currently being tracked."
                );
              }
              
              const channelList = channels.map(channel => ({
                id: channel.channelId,
                name: channel.name,
                subscribers: channel.metrics.subscribers,
                views: channel.metrics.views,
                monitoringTier: channel.monitoringTier,
                lastChecked: new Date(channel.metrics.lastChecked).toISOString()
              }));
              
              const feedbackMessage = `Currently tracking ${channels.length} channels:\n${JSON.stringify(channelList, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch tracked channels: ${errorMessage}`
              );
            }
          }
        });
      }
      
      // Get channel metrics
      get getChannelMetricsFunction() {
        return new GameFunction({
          name: "get_channel_metrics",
          description: "Get detailed metrics for a specific channel",
          args: [{ 
            name: "channel_id", 
            description: "The ID of the channel to get metrics for" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.channel_id) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Channel ID is required"
                );
              }
              
              logger(`Fetching metrics for channel: ${args.channel_id}`);
              
              // Get current data from database
              const channelData = await storage.getChannel(args.channel_id);
              
              if (!channelData) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Channel with ID ${args.channel_id} is not being tracked`
                );
              }
              
              // Get fresh data from YouTube
              const latestData = await this.youtubeClient.getChannel(args.channel_id);
              
              if (!latestData) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Could not fetch current data for channel ${channelData.name}`
                );
              }
              
              // Calculate growth metrics
              const subscriberGrowth = latestData.statistics.subscriberCount - channelData.metrics.subscribers;
              const viewGrowth = latestData.statistics.viewCount - channelData.metrics.views;
              
              // Get latest videos
              const latestVideos = await this.youtubeClient.getLatestVideos(args.channel_id, 3);
              
              // Format response
              const metricsReport = {
                channelName: channelData.name,
                monitoringTier: channelData.monitoringTier,
                currentMetrics: {
                  subscribers: latestData.statistics.subscriberCount,
                  views: latestData.statistics.viewCount,
                  videos: latestData.statistics.videoCount
                },
                growth: {
                  subscribers: subscriberGrowth,
                  subscriberPercentage: channelData.metrics.subscribers > 0 ? 
                    (subscriberGrowth / channelData.metrics.subscribers * 100).toFixed(2) + '%' : 'N/A',
                  views: viewGrowth,
                  viewPercentage: channelData.metrics.views > 0 ? 
                    (viewGrowth / channelData.metrics.views * 100).toFixed(2) + '%' : 'N/A'
                },
                lastVideo: channelData.metrics.lastVideoId ? 
                  `https://www.youtube.com/watch?v=${channelData.metrics.lastVideoId}` : 'No video tracked yet',
                latestVideos: latestVideos.map(video => ({
                  title: video.title,
                  published: new Date(video.publishedAt).toISOString(),
                  views: video.statistics.viewCount,
                  likes: video.statistics.likeCount
                })),
                lastUpdated: new Date(channelData.metrics.lastChecked).toISOString(),
                lastTrendingDate: channelData.lastTrendingDate.toISOString()
              };
              
              // Update channel metrics in database with latest data
              const updatedMetrics = {
                subscribers: latestData.statistics.subscriberCount,
                views: latestData.statistics.viewCount,
                likes: channelData.metrics.likes, // Keep existing likes data
                lastVideoId: channelData.metrics.lastVideoId, // Keep existing last video ID
                lastVideoTimestamp: channelData.metrics.lastVideoTimestamp,
                lastChecked: Date.now()
              };
              
              await storage.updateChannelMetrics(args.channel_id, updatedMetrics);
              
              const feedbackMessage = `Channel metrics for ${channelData.name}:\n${JSON.stringify(metricsReport, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch channel metrics: ${errorMessage}`
              );
            }
          }
        });
      }
      
      // Get trending videos
      get getTrendingVideosFunction() {
        return new GameFunction({
          name: "get_trending_videos",
          description: "Get the current trending videos on YouTube",
          args: [{ 
            name: "region_code", 
            description: "The region code to get trending videos for (default: US)" 
          }] as const,
          executable: async (args, logger) => {
            try {
              const regionCode = args.region_code || 'US';
              
              logger(`Fetching trending videos for region: ${regionCode}`);
              
              const trendingVideos = await this.youtubeClient.getTrendingVideos(regionCode, 10);
              
              if (trendingVideos.length === 0) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  `No trending videos found for region ${regionCode}`
                );
              }
              
              const videoList = trendingVideos.map(video => ({
                title: video.title,
                channel: video.channelTitle,
                views: video.statistics.viewCount,
                likes: video.statistics.likeCount,
                comments: video.statistics.commentCount,
                url: `https://www.youtube.com/watch?v=${video.id}`
              }));
              
              const feedbackMessage = `Top trending videos for ${regionCode}:\n${JSON.stringify(videoList, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch trending videos: ${errorMessage}`
              );
            }
          }
        });
      }

      // Track a youtube channel and save it to db
      public async trackChannel(channelId: string): Promise<{success: boolean, message: string}> {
        try {
            // Validate the channelId
            if(!channelId.trim()) {
                return {success: false, message: "Channel ID cannot be empty"};
            }
            
            // Check if we're already tracking this channel
            const existingChannel = await storage.getChannel(channelId);
            if(existingChannel) {
                return {success: false, message: `Already tracking channel with ID ${channelId}`};
            }
            
            // Get channel info from YouTube API
            const channelInfo = await this.youtubeClient.getChannel(channelId);
            
            if(!channelInfo) {
                return {success: false, message: `Could not find channel with ID ${channelId}`};
            }
            
            // Get total likes as an additional metric
            const totalLikes = await this.youtubeClient.getTotalChannelLikes(channelId);
            
            // Create channel in database
            const currentMetrics = {
                subscribers: channelInfo.statistics.subscriberCount,
                views: channelInfo.statistics.viewCount,
                likes: totalLikes,
                lastVideoId: '',
                lastVideoTimestamp: 0,
                lastChecked: Date.now()
            };
            
            await storage.createChannel(
                channelId,
                channelInfo.title,
                currentMetrics
            );
            
            // Optionally post to Twitter
            if (this.twitterPlugin) {
                await this.twitterPlugin.postTweetFunction.executable({
                    tweet: TweetFormatter.formatTrackingAnnouncementTweet(channelInfo),
                    tweet_reasoning: "Announcing new channel tracking to followers"
                }, (message: string) => console.log(message));
            }
            
            return {success: true, message: `Now tracking YouTube channel "${channelInfo.title}"`};
        } catch (error: any) {
            console.error("Error tracking channel:", error);
            return {success: false, message: `Error tracking channel: ${error.message}`};
        }
    }

    // Direct tweet function
    get tweetFunction() {
      return new GameFunction({
        name: "tweet",
        description: "Post a tweet directly to Twitter",
        args: [
          { name: "message", description: "The content of the tweet" },
          { name: "context", description: "Optional context about what this tweet refers to (e.g., channel name, event, etc.)" }
        ] as const,
        executable: async (args, logger) => {
          try {
            if (!args.message) {
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Tweet content is required"
              );
            }

            logger(`Attempting to post tweet directly: ${args.message.substring(0, 50)}...`);
            
            if (!this.twitterPlugin) {
              logger("No Twitter plugin available, cannot post tweet");
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Twitter integration not available"
              );
            }
            
            // Generate AI reasoning for this tweet
            let tweetReasoning = "Direct tweet request";
            if (args.context) {
              const topics = AIResponseGenerator.extractTopics(args.message);
              tweetReasoning = `Tweeting about ${args.context} - ${topics.length > 0 ? 
                'focusing on ' + topics.join(', ') : 
                'providing general updates'}`;
            }
            
            logger(`Tweet reasoning: ${tweetReasoning}`);
            
            try {
              // Direct access to client for more reliable posting
              const twitterClient = (this.twitterPlugin as any).twitterClient;
              
              if (!twitterClient || typeof twitterClient.post !== 'function') {
                logger("Twitter client not properly configured");
                throw new Error("Twitter client not properly configured");
              }
              
              // Post directly using the client
              logger("Posting directly via Twitter client");
              await twitterClient.post(args.message);
              logger("Tweet posted successfully via direct client access!");
              
              // Update tweet count in state
              this.updateState({ 
                totalTweets: (this.state.totalTweets || 0) + 1 
              });
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                "Tweet posted successfully via direct access"
              );
            } catch (directError: any) {
              logger(`Direct posting failed: ${directError.message}`);
              
              // Fall back to GameFunction method
              logger("Falling back to standard Twitter function");
              
              // Get the post tweet function
              const postTweetFunction = this.twitterPlugin.postTweetFunction;
              
              if (!postTweetFunction) {
                throw new Error("Twitter plugin does not have a postTweetFunction");
              }
              
              // Execute the tweet function
              const result = await postTweetFunction.executable({ 
                tweet: args.message, 
                tweet_reasoning: tweetReasoning
              }, logger);
              
              if (result.status === ExecutableGameFunctionStatus.Done) {
                logger("Tweet posted successfully via function!");
                
                // Update tweet count in state
                this.updateState({ 
                  totalTweets: (this.state.totalTweets || 0) + 1 
                });
                
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  "Tweet posted successfully via function"
                );
              } else {
                throw new Error(`Twitter function failed: ${result.status}`);
              }
            }
          } catch (error: any) {
            logger(`Failed to post tweet: ${error.message}`);
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              `Failed to post tweet: ${error.message}`
            );
          }
        }
      });
    }

    // Add getter for monitoring status
    public get isMonitoring(): boolean {
        // Use type assertion to safely access the property
        return (this.scheduler as any).isRunning;
    }
}

export { YoutubePlugin };