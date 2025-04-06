import { GameWorker,GameFunction,ExecutableGameFunctionResponse,ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { youtubeClient,YoutubeChannel,YoutubeVideo } from "./youtubeClient";
import { YoutubeScheduler } from "./youtubeScheduler";

import * as storage from "../db/storage";

import TwitterPlugin from "../../twitterPlugin/src/twitterPlugin";
import { TweetFormatter } from "./tweetFormatter";

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
    private twitterPlugin?: TwitterPlugin;
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
    public async postTweet(content: string, reason: string): Promise<boolean> {
        if (!this.twitterPlugin) {
            console.log("No Twitter plugin configured, skipping tweet:", content);
            return false;
        }

        try {
            console.log(`Sending tweet: ${content.substring(0, 50)}... (${reason})`);
            
            // Get the tweet function from the Twitter plugin
            const tweetFn = (this.twitterPlugin as any).postTweetFunction;
            if (!tweetFn || !tweetFn.executable) {
                throw new Error("Twitter plugin does not have a valid post tweet function");
            }
            
            // Execute the tweet function
            const mockLogger = (msg: string) => console.log(`Posting tweet: ${msg}`);
            const result = await tweetFn.executable({ 
                tweet: content, 
                tweet_reasoning: reason 
            }, mockLogger);
            
            // Update tweet count on success
            if (result && result.status === ExecutableGameFunctionStatus.Done) {
                this.updateState({ totalTweets: (this.state.totalTweets || 0) + 1 });
                return true;
            }
            
            console.error("Failed to post tweet:", result?.message || "Unknown error");
            return false;
        } catch (error) {
            console.error("Error posting tweet:", error);
            return false;
        }
    }

    public getWorker(data?: {
        functions?: GameFunction<any>[];
        getEnvironment?: () => Promise<Record<string, any>>;
      }): GameWorker {
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
            this.stopMonitoringFunction
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
}

export { YoutubePlugin };