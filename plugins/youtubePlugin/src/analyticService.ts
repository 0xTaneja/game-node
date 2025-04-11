import { YoutubeChannel, youtubeClient } from './youtubeClient';
import { ChannelMetrics, IChannel, getAdaptiveThreshold } from '../db/storage';

/**
 * Result of metrics analysis
 */
export interface MetricsAnalysis {
    hasSignificantChange: boolean;
    hasSignificantViewsChange: boolean;
    hasSignificantSubsChange: boolean;
    hasSignificantLikesChange: boolean;
    viewsChangePercent: number;
    subsChangePercent: number;
    likesChangePercent: number;
}

/**
 * Analytics service for YouTube data
 */
export class AnalyticService {
    /**
     * Calculate engagement score for a channel
     * @param channel YouTube channel
     * @returns Engagement score (higher is better)
     */
    public static calculateEngagementScore(channel: YoutubeChannel): number {
        const stats = channel.statistics;
        
        // Basic metrics
        const subscribers = stats.subscriberCount || 0;
        const views = stats.viewCount || 0;
        const videoCount = stats.videoCount || 1; // Avoid division by zero
        
        // Calculate views per video
        const viewsPerVideo = views / videoCount;
        
        // Calculate views to subscriber ratio (engagement metric)
        const viewToSubRatio = subscribers > 0 ? views / subscribers : 0;
        
        // Calculate base score
        let score = viewsPerVideo * 0.4 + viewToSubRatio * 0.6;
        
        // Apply channel size factor (to normalize scores across different sized channels)
        const sizeFactor = this.getChannelSizeFactor(subscribers);
        score = score * sizeFactor;
        
        return score;
    }
    
    /**
     * Analyze metrics changes and determine if they're significant
     * @param oldMetrics Previous metrics
     * @param newMetrics Current metrics
     * @returns Analysis result
     */
    public static analyzeMetricsChanges(
        oldMetrics: ChannelMetrics, 
        newMetrics: ChannelMetrics
    ): MetricsAnalysis {
        // Calculate percentage changes
        const subsChangePercent = this.calculatePercentChange(
            oldMetrics.subscribers, 
            newMetrics.subscribers
        );
        
        const viewsChangePercent = this.calculatePercentChange(
            oldMetrics.views, 
            newMetrics.views
        );
        
        const likesChangePercent = this.calculatePercentChange(
            oldMetrics.likes, 
            newMetrics.likes
        );
        
        // Get adaptive thresholds based on channel size
        const subsThreshold = getAdaptiveThreshold('SUBS_CHANGE', newMetrics.subscribers);
        const viewsThreshold = getAdaptiveThreshold('VIEWS_CHANGE', newMetrics.views);
        const likesThreshold = getAdaptiveThreshold('LIKES_CHANGE', newMetrics.likes);
        
        // Check if changes are significant
        const hasSignificantSubsChange = Math.abs(subsChangePercent) >= subsThreshold;
        const hasSignificantViewsChange = Math.abs(viewsChangePercent) >= viewsThreshold;
        const hasSignificantLikesChange = oldMetrics.likes > 0 && Math.abs(likesChangePercent) >= likesThreshold;
        
        // Overall significance
        const hasSignificantChange = 
            hasSignificantSubsChange || 
            hasSignificantViewsChange || 
            hasSignificantLikesChange;
        
        return {
            hasSignificantChange,
            hasSignificantSubsChange,
            hasSignificantViewsChange,
            hasSignificantLikesChange,
            subsChangePercent,
            viewsChangePercent,
            likesChangePercent
        };
    }
    
    /**
     * Get trending creators based on engagement scores
     * @param client YouTube API client or array of channels
     * @param limit Maximum number of creators to return
     * @returns Array of top trending creators
     */
    public static async getTrendingCreators(
        client: youtubeClient | YoutubeChannel[], 
        limit: number = 5
    ): Promise<YoutubeChannel[]> {
        // If client is a youtubeClient, fetch trending videos and channels
        if (typeof (client as youtubeClient).searchChannels === 'function') {
            const youtubeApi = client as youtubeClient;
            
            try {
                console.log("Fetching trending videos to find trending creators...");
                
                // Get trending videos
                const trendingVideos = await youtubeApi.getTrendingVideos("US", 50);
                
                if (!trendingVideos || trendingVideos.length === 0) {
                    console.log("No trending videos found");
                    return [];
                }
                
                console.log(`Found ${trendingVideos.length} trending videos`);
                
                // Extract unique channel IDs from trending videos
                const channelIds = [...new Set(trendingVideos.map(video => video.channelId))];
                console.log(`Extracted ${channelIds.length} unique channels from trending videos`);
                
                // Fetch details for each channel
                const channelPromises = channelIds.map(id => youtubeApi.getChannel(id));
                const channelsResult = await Promise.allSettled(channelPromises);
                
                // Filter out channels that were successfully retrieved
                const channels = channelsResult
                    .filter((result): result is PromiseFulfilledResult<YoutubeChannel> => 
                        result.status === 'fulfilled' && result.value !== null
                    )
                    .map(result => result.value);
                
                console.log(`Successfully retrieved ${channels.length} channels`);
                
                // Calculate engagement scores and sort
                return this.rankChannelsByEngagement(channels, limit);
            } catch (error) {
                console.error("Error fetching trending creators:", error);
                return [];
            }
        } else {
            // If an array of channels was provided, just rank them
            const channels = client as YoutubeChannel[];
            return this.rankChannelsByEngagement(channels, limit);
        }
    }
    
    /**
     * Rank channels by engagement score
     * @param channels Array of YouTube channels
     * @param limit Maximum number to return
     * @returns Top channels by engagement score
     */
    private static rankChannelsByEngagement(channels: YoutubeChannel[], limit: number): YoutubeChannel[] {
        if (!channels || channels.length === 0) return [];
        
        // Calculate engagement scores for all channels
        const channelsWithScores = channels.map(channel => ({
            channel,
            score: this.calculateEngagementScore(channel)
        }));
        
        // Sort by engagement score (descending)
        channelsWithScores.sort((a, b) => b.score - a.score);
        
        // Return top channels
        return channelsWithScores
            .slice(0, limit)
            .map(item => item.channel);
    }
    
    /**
     * Calculate growth leaderboard
     * @param channels YouTube channels (current data)
     * @param storedChannels Stored channel data (with historical metrics)
     * @returns Array of creators with growth rates
     */
    public static calculateGrowthLeaderboard(
        channels: YoutubeChannel[], 
        storedChannels: IChannel[]
    ): any[] {
        if (!channels || channels.length === 0) return [];
        
        const result = [];
        
        // Process each channel
        for (const channel of channels) {
            // Find matching stored channel
            const storedChannel = storedChannels.find(c => c.channelId === channel.id);
            if (!storedChannel) continue;
            
            // Skip if less than 1 day of data
            const daysSinceLastCheck = 
                (Date.now() - storedChannel.metrics.lastChecked) / (24 * 60 * 60 * 1000);
            if (daysSinceLastCheck < 1) continue;
            
            // Calculate growth rate (subscribers)
            const growthRate = this.calculatePercentChange(
                storedChannel.metrics.subscribers,
                channel.statistics.subscriberCount
            );
            
            // Skip negative growth
            if (growthRate <= 0) continue;
            
            result.push({
                channel,
                growthRate,
                storedChannel
            });
        }
        
        // Sort by growth rate (descending)
        result.sort((a, b) => b.growthRate - a.growthRate);
        
        return result;
    }
    
    /**
     * Determine monitoring tier based on days since trending
     * @param daysSinceTrending Days since channel was trending
     * @returns Monitoring tier (1-3)
     */
    public static determineMonitoringTier(daysSinceTrending: number): number {
        if (daysSinceTrending < 1) {
            return 1; // Tier 1: Current trending (check every 30 minutes)
        } else if (daysSinceTrending < 3) {
            return 2; // Tier 2: Recently trending (check every 2 hours)
        } else {
            return 3; // Tier 3: Previously trending (check once daily)
        }
    }
    
    /**
     * Calculate percentage change between two values
     * @param oldValue Old value
     * @param newValue New value
     * @returns Percentage change
     */
    private static calculatePercentChange(oldValue: number, newValue: number): number {
        if (oldValue === 0) return 0;
        return ((newValue - oldValue) / oldValue) * 100;
    }
    
    /**
     * Get channel size factor for score normalization
     * @param subscribers Number of subscribers
     * @returns Size factor
     */
    private static getChannelSizeFactor(subscribers: number): number {
        if (subscribers < 1000) {
            return 2.0; // Boost small channels
        } else if (subscribers < 10000) {
            return 1.5;
        } else if (subscribers < 100000) {
            return 1.2;
        } else if (subscribers < 1000000) {
            return 1.0; // Baseline
        } else if (subscribers < 10000000) {
            return 0.8;
        } else {
            return 0.6; // Reduce mega channels
        }
    }
} 