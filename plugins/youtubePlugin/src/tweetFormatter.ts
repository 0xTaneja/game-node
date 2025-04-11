import { YoutubeChannel, YoutubeVideo } from './youtubeClient';
import { IChannel, ChannelMetrics } from '../db/storage';

/**
 * Utility class for formatting tweets related to YouTube creator metrics
 * and events. Includes rich text formatting, emoji usage, and number formatting.
 */
export class TweetFormatter {
  /**
   * Format a number for display in tweets
   * @param num Number to format
   * @param useSeparators Whether to use thousand separators
   * @returns Formatted number string
   */
  static formatNumber(num: number, useSeparators = true): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return useSeparators ? num.toLocaleString() : num.toString();
  }

  /**
   * Format a percentage change with appropriate indicators
   * @param oldValue Previous value
   * @param newValue Current value
   * @returns Formatted percentage string with direction indicator
   */
  static formatPercentageChange(oldValue: number, newValue: number): string {
    if (oldValue === 0) return '';
    
    const percentChange = ((newValue - oldValue) / oldValue) * 100;
    const absChange = Math.abs(percentChange).toFixed(2);
    
    if (percentChange > 0) {
      return `⬆️ +${absChange}%`;
    } else if (percentChange < 0) {
      return `⬇️ -${absChange}%`;
    }
    return '';
  }

  /**
   * Ensure tweet doesn't exceed Twitter's character limit
   * @param tweet Tweet text
   * @param maxLength Maximum allowed length (default: 280)
   * @returns Trimmed tweet that fits within limits
   */
  static enforceTweetLength(tweet: string, maxLength: number = 280): string {
    if (tweet.length <= maxLength) {
      return tweet;
    }
    
    // If tweet is too long, trim it and add ellipsis
    console.log(`Tweet too long (${tweet.length} chars), trimming to ${maxLength}`);
    return tweet.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format a new video announcement tweet
   * @param channel YouTube channel
   * @param video Latest video
   * @returns Formatted tweet text
   */
  static formatNewVideoTweet(channel: YoutubeChannel, video: YoutubeVideo): string {
    // Select a random emoji for variety
    const emojis = ['🎥', '📹', '🎬', '📺', '🔴'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    // Simple format with video details
    const tweet = `${randomEmoji} NEW: "${video.title}" by ${channel.title}\n` +
           `🔗 https://youtu.be/${video.id}\n` +
           `#YouTube #NewVideo`;
           
    return this.enforceTweetLength(tweet);
  }

  /**
   * Format a metrics update tweet
   * @param channelInfo YouTube channel info
   * @param oldMetrics Previous metrics
   * @param currentMetrics Current metrics
   * @returns Formatted tweet text
   */
  static formatMetricsUpdateTweet(
    channelInfo: YoutubeChannel,
    oldMetrics: ChannelMetrics,
    currentMetrics: ChannelMetrics
  ): string {
    const timestamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    
    // Calculate changes and percentages
    const subChange = currentMetrics.subscribers - oldMetrics.subscribers;
    const viewChange = currentMetrics.views - oldMetrics.views;
    const subChangePercent = oldMetrics.subscribers > 0 ? 
      ((subChange / oldMetrics.subscribers) * 100).toFixed(2) : '0.00';
    const viewChangePercent = oldMetrics.views > 0 ? 
      ((viewChange / oldMetrics.views) * 100).toFixed(2) : '0.00';
    
    // Format numbers with appropriate units
    const formatSubs = this.formatNumber(currentMetrics.subscribers);
    const formatViews = this.formatNumber(currentMetrics.views);
    const formatSubChange = this.formatNumber(Math.abs(subChange));
    const formatViewChange = this.formatNumber(Math.abs(viewChange));
    
    // Create descriptive header with timestamp
    const header = `📊 CHANNEL UPDATE • ${timestamp}\n`;
    
    // Add channel name with link
    const channelLine = `🎥 ${channelInfo.title}\n`;
    
    // Create detailed metrics section
    const metricsSection = 
      `👥 Subscribers: ${formatSubs} (${subChange >= 0 ? '↑' : '↓'} ${formatSubChange} | ${subChangePercent}%)\n` +
      `👁️ Total Views: ${formatViews} (${viewChange >= 0 ? '↑' : '↓'} ${formatViewChange} | ${viewChangePercent}%)\n`;
    
    // Add growth context
    const growthContext = this.getGrowthContext(subChange, viewChange);
    
    // Add relevant hashtags
    const hashtags = '#YouTubeGrowth #CreatorAnalytics #YouTubeStats';
    
    return this.enforceTweetLength(
      header + 
      channelLine + 
      metricsSection + 
      growthContext + 
      hashtags
    );
  }

  private static getGrowthContext(subChange: number, viewChange: number): string {
    const subGrowthRate = subChange / 1000; // Growth per 1K subs
    const viewGrowthRate = viewChange / 1000000; // Growth per 1M views
    
    let context = '';
    
    if (subGrowthRate > 10) {
      context += '🚀 Rapid subscriber growth!\n';
    } else if (subGrowthRate > 5) {
      context += '📈 Steady subscriber growth\n';
    }
    
    if (viewGrowthRate > 1) {
      context += '🔥 High view momentum\n';
    } else if (viewGrowthRate > 0.5) {
      context += '📊 Consistent view growth\n';
    }
    
    return context;
  }

  /**
   * Format a trending creators leaderboard tweet
   * @param topCreators Array of trending channels
   * @returns Formatted tweet text
   */
  static formatTrendingCreatorsTweet(topCreators: YoutubeChannel[]): string {
    const date = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    // Create attention-grabbing header with date
    const headerText = `🔥 TRENDING CREATORS • ${date} 🔥\n\n`;
    
    // Format each creator entry with minimal details to keep tweet short
    const creatorEntries = topCreators.map((creator, i) => {
      const rank = this.formatRank(i + 1);
      const subs = this.formatNumber(creator.statistics.subscriberCount);
      
      // Simplified format with just name and subscribers
      return `${rank} ${creator.title} (${subs} subs)`;
    });
    
    // Add engaging footer with call to action
    const footerText = `\n\n📈 Follow these creators for amazing content!\n#YouTube #TrendingCreators`;
    
    return this.enforceTweetLength(headerText + creatorEntries.join('\n') + footerText);
  }

  /**
   * Format a daily leaderboard tweet
   * @param topGrowers Array of creators with highest growth
   * @returns Formatted tweet text
   */
  static formatDailyLeaderboardTweet(topGrowers: Array<{
    name: string;
    subscribers: number;
    growth: number;
    channelId: string;
  }>): string {
    const date = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    // Create trophy-themed header
    const headerText = `🏆 DAILY GROWTH CHAMPIONS • ${date} 🏆\n\n`;
    
    // Format each creator entry with growth stats
    const creatorEntries = topGrowers.map((creator, i) => {
      const rank = this.formatRank(i + 1);
      const subs = this.formatNumber(creator.subscribers);
      const growthEmoji = creator.growth > 0 ? '📈' : '📉';
      const growthText = Math.abs(creator.growth).toFixed(2);
      
      return `${rank} ${creator.name}\n` +
             `   👥 ${subs} Subscribers\n` +
             `   ${growthEmoji} ${growthText}% change in 24hrs`;
    });
    
    // Add inspiring footer
    const footerText = `\n\n🚀 Keep growing, creators! Who will top tomorrow's list? 🤔\n#YouTubeGrowth #CreatorEconomy #ContentCreators`;
    
    return this.enforceTweetLength(headerText + creatorEntries.join('\n\n') + footerText);
  }

  /**
   * Format a tracking announcement tweet
   * @param channelInfo YouTube channel being tracked
   * @returns Formatted tweet text
   */
  static formatTrackingAnnouncementTweet(channelInfo: YoutubeChannel): string {
    const tweet = `📡 NOW TRACKING: ${channelInfo.title}!\n` +
           `👥 ${this.formatNumber(channelInfo.statistics.subscriberCount)} subs • ` +
           `👁️ ${this.formatNumber(channelInfo.statistics.viewCount)} views\n` +
           `#YouTubeCreator #ContentCreation`;
           
    return this.enforceTweetLength(tweet);
  }

  /**
   * Format rank with appropriate emoji
   * @param rank Numeric rank
   * @returns Formatted rank string
   */
  private static formatRank(rank: number): string {
    // Use medals for top 3, star for others
    if (rank <= 3) {
      const medals = ['🥇', '🥈', '🥉'];
      return `${medals[rank - 1]} #${rank}`;
    } else {
      return `⭐ #${rank}`; // Use star emoji for ranks 4 and beyond
    }
  }
} 