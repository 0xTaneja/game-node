import mongoose,{Schema,Document,model,connect, mongo} from "mongoose";
import dotenv from "dotenv";


dotenv.config();


export interface ChannelMetrics {
subscribers:number;
views:number;
likes:number;
lastVideoId :string;
lastVideoTimestamp:number;
lastChecked:number;
}

export interface IChannel extends Document {

 channelId:string;
 name:string;
 isTracking:boolean;
 lastTrendingDate:Date;
 monitoringTier:number; // 1 = current trending, 2 = recently trending, 3 = previously trending
 metrics:ChannelMetrics;
 metricsHistory:ChannelMetrics[];   
}


const ChannelSchema = new Schema <IChannel>({
    channelId:{type:String,required:true,unique:true},
    name : {type:String,required:true},
    isTracking:{type:Boolean,default:true},
    lastTrendingDate:{type:Date,default:Date.now},
    monitoringTier:{type:Number,default:3}, // Default to lowest priority tier
    metrics:{
        subscribers:{type:Number,default:0},
        views:{type:Number,default:0},
        likes:{type:Number,default:0},
        lastVideoId:{type:String,default:''},
        lastVideoTimestamp:{type:Number,default:0},
        lastChecked:{type:Number,default:Date.now}

    },
    metricsHistory:[{
        subscribers:Number,
        views:Number,
        likes:Number,
        lastVideoId:String,
        lastVideoTimestamp:Number,
        lastChecked:Number
    }]
});


export const Channel = mongoose.models.Channel || model<IChannel>('Channel',ChannelSchema);

let isConnected = false;

export async function connectDB(){
    if(isConnected) return;
    const MONGODB_URI = process.env.MONGODB_URI||'mongodb://localhost:27017/youtubePlugin';
    const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'youtube_monitor';

    try{
      // Force disconnection if there was a previous connection with wrong database
      if (mongoose.connection.readyState !== 0) {
        console.log("Disconnecting from previous MongoDB connection");
        await mongoose.disconnect();
      }
      
      // Ensure the URI includes the correct database name
      let uri = MONGODB_URI;
      if (!uri.endsWith(MONGODB_DB_NAME)) {
        // If URI doesn't end with the database name, append it
        if (uri.includes('?')) {
          // URI has parameters
          const uriParts = uri.split('?');
          uri = `${uriParts[0].replace(/\/[^/]*$/, '')}/${MONGODB_DB_NAME}?${uriParts[1]}`;
        } else {
          // URI has no parameters
          uri = `${uri.replace(/\/[^/]*$/, '')}/${MONGODB_DB_NAME}`;
        }
      }
      
      console.log(`Connecting to MongoDB with database: ${MONGODB_DB_NAME}`);
      console.log(`Connection URI: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`); // Log URI with credentials masked
      
      // Connect with the updated URI
      await connect(uri);
      
      isConnected = true;
      console.log(`MongoDB connected successfully to database: ${MONGODB_DB_NAME}`);
      
      // Verify the database being used
      if (mongoose.connection.readyState === 1) {
        try {
          const dbName = mongoose.connection.db?.databaseName;
          console.log(`Active database: ${dbName}`);
          if (dbName !== MONGODB_DB_NAME) {
            console.warn(`WARNING: Connected to ${dbName} instead of ${MONGODB_DB_NAME}!`);
          }
        } catch (error) {
          console.warn("Unable to get database name:", error);
        }
      } else {
        console.warn("Connection not ready, can't verify database name");
      }
    }
    catch(error){
     console.error('MongoDB Connection Error:', error);
     throw error;
    }
}

export async function getAllTrackedChannels(filter?: Partial<IChannel>): Promise<IChannel[]> {
    await connectDB();
    
    // Start with base query for tracked channels
    let query: any = { isTracking: true };
    
    // Add any additional filters
    if (filter) {
        query = { ...query, ...filter };
    }
    
    return Channel.find(query).exec();
}

export async function getChannel(channelId:string):Promise<IChannel | null>{
    await connectDB();
    return Channel.findOne({channelId}).exec();
}

export async function updateChannelMetrics(channelId:string, metrics:ChannelMetrics): Promise<IChannel | null> {
    await connectDB();

    const channel = await Channel.findOne({channelId});

    if(!channel) {
        console.error(`Cannot update metrics: Channel with ID ${channelId} not found`);
        return null;
    }

    // Log previous metrics
    console.log(`Updating metrics for channel: ${channel.name} (${channelId})`);
    console.log('Previous metrics:', {
        subscribers: channel.metrics.subscribers,
        views: channel.metrics.views,
        likes: channel.metrics.likes,
        lastChecked: new Date(channel.metrics.lastChecked).toISOString()
    });
    
    // Log new metrics and calculate changes
    console.log('New metrics:', {
        subscribers: metrics.subscribers,
        views: metrics.views,
        likes: metrics.likes,
        lastChecked: new Date(metrics.lastChecked).toISOString()
    });
    
    // Calculate and log percentage changes
    const subscriberChange = calculatePercentageChange(channel.metrics.subscribers, metrics.subscribers);
    const viewsChange = calculatePercentageChange(channel.metrics.views, metrics.views);
    const likesChange = calculatePercentageChange(channel.metrics.likes, metrics.likes);
    
    console.log('Metrics changes:', {
        subscribers: `${subscriberChange > 0 ? '+' : ''}${subscriberChange.toFixed(2)}%`,
        views: `${viewsChange > 0 ? '+' : ''}${viewsChange.toFixed(2)}%`,
        likes: `${likesChange > 0 ? '+' : ''}${likesChange.toFixed(2)}%`
    });
    
    // Determine if changes are significant based on adaptive thresholds
    const subsThreshold = getAdaptiveThreshold('SUBS_CHANGE', metrics.subscribers);
    const viewsThreshold = getAdaptiveThreshold('VIEWS_CHANGE', metrics.views);
    const likesThreshold = getAdaptiveThreshold('LIKES_CHANGE', metrics.likes);
    
    console.log('Adaptive thresholds:', {
        subscribers: `${(subsThreshold * 100).toFixed(3)}%`,
        views: `${(viewsThreshold * 100).toFixed(3)}%`,
        likes: `${(likesThreshold * 100).toFixed(3)}%`
    });
    
    const isSignificantSubs = Math.abs(subscriberChange / 100) > subsThreshold;
    const isSignificantViews = Math.abs(viewsChange / 100) > viewsThreshold;
    const isSignificantLikes = Math.abs(likesChange / 100) > likesThreshold;
    
    console.log('Significant changes detected:', {
        subscribers: isSignificantSubs,
        views: isSignificantViews,
        likes: isSignificantLikes,
        any: isSignificantSubs || isSignificantViews || isSignificantLikes
    });

    // Initialize metrics history array if it doesn't exist
    if(!channel.metricsHistory) {
        channel.metricsHistory = [];
    }

    // Store current metrics in history with timestamp
    const metricsCopy = {
        subscribers: channel.metrics.subscribers,
        views: channel.metrics.views,
        likes: channel.metrics.likes,
        lastVideoId: channel.metrics.lastVideoId,
        lastVideoTimestamp: channel.metrics.lastVideoTimestamp,
        lastChecked: channel.metrics.lastChecked
    };
    
    // Limit history to 30 data points
    if(channel.metricsHistory.length >= 30) {
        channel.metricsHistory.shift();
        console.log('Metrics history at capacity, removing oldest entry');
    }

    channel.metricsHistory.push(metricsCopy);
    console.log(`Added metrics to history (${channel.metricsHistory.length} entries)`);

    // Update current metrics
    channel.metrics = metrics;

    try {
        await channel.save();
        console.log(`Successfully updated metrics for ${channel.name}`);
        return channel;
    } catch (error) {
        console.error(`Error saving updated metrics for ${channel.name}:`, error);
        throw error;
    }
}

// Helper function to calculate percentage change
function calculatePercentageChange(oldValue: number, newValue: number): number {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue) * 100;
}

export async function createChannel(channelId:string,name:string,metrics:ChannelMetrics):Promise<IChannel>{
    await connectDB();

    const newChannel = new Channel({
       channelId,
       name,
       metrics,
       isTracking:true,
       lastTrendingDate:new Date(),
       monitoringTier:1, // New channels from trending start at tier 1
       metricsHistory:[]
    });

    await newChannel.save();
    return newChannel;
}

// Add this method to update channel properties
export async function updateChannel(channelId: string, updates: Partial<IChannel>): Promise<IChannel | null> {
    await connectDB();
    return Channel.findOneAndUpdate(
        { channelId }, 
        updates, 
        { new: true }
    ).exec();
}

// Check if metric change is significant
export function isSignificantChange(oldValue: number, newValue: number, threshold: number = 0.05): boolean {
  if (oldValue === 0) return newValue > 0;
  
  const percentChange = Math.abs((newValue - oldValue) / oldValue);
  return percentChange > threshold;
}

// Calculate adaptive threshold based on channel size
export function getAdaptiveThreshold(metricType: string, count: number): number {
  // Base thresholds
  const baseThresholds = {
    VIEWS_CHANGE: 0.001, // 0.1%
    LIKES_CHANGE: 0.002, // 0.2%
    SUBS_CHANGE: 0.001  // 0.1%
  };
  
  const baseThreshold = baseThresholds[metricType as keyof typeof baseThresholds] || 0.01;
  
  // Scale thresholds based on creator size
  if (metricType === 'SUBS_CHANGE') {
    if (count < 10000) return baseThreshold * 2;       // More sensitive for small channels
    if (count < 100000) return baseThreshold * 1.5;    // Slightly more sensitive for medium channels
    if (count < 1000000) return baseThreshold;         // Base threshold for large channels
    return baseThreshold * 0.5;                        // Less sensitive for very large channels
  } 
  else if (metricType === 'VIEWS_CHANGE') {
    if (count < 100000) return baseThreshold * 2;      // More sensitive for small channels
    if (count < 1000000) return baseThreshold * 1.5;   // Slightly more sensitive for medium channels
    if (count < 10000000) return baseThreshold;        // Base threshold for large channels
    return baseThreshold * 0.5;                        // Less sensitive for very large channels
  }
  else if (metricType === 'LIKES_CHANGE') {
    if (count < 10000) return baseThreshold * 2;       // More sensitive for small channels
    if (count < 100000) return baseThreshold * 1.5;    // Slightly more sensitive for medium channels
    if (count < 1000000) return baseThreshold;         // Base threshold for large channels
    return baseThreshold * 0.5;                        // Less sensitive for very large channels
  }
  
  // Default fallback
  return baseThreshold;
}

/**
 * Get the count of all tracked channels
 * @returns number of tracked channels
 */
export async function getChannelCount(): Promise<number> {
    await connectDB();
    return Channel.countDocuments({ isTracking: true }).exec();
}

/**
 * Check if a channel is already being tracked
 * @param channelId The YouTube channel ID to check
 * @returns True if channel is already being tracked
 */
export async function isChannelTracked(channelId: string): Promise<boolean> {
    await connectDB();
    const channel = await Channel.findOne({ channelId }).exec();
    return channel !== null;
}

/**
 * Track a new YouTube channel
 * @param channelData The channel data including ID, name, and metrics
 * @returns The newly created channel document
 */
export async function trackChannel(channelData: {
    channelId: string;
    name: string;
    monitoringTier?: number;
    metrics: ChannelMetrics;
}): Promise<IChannel> {
    await connectDB();
    
    // Check if channel already exists
    const existingChannel = await Channel.findOne({ channelId: channelData.channelId }).exec();
    if (existingChannel) {
        console.log(`Channel ${channelData.name} is already being tracked, updating instead`);
        
        // Update existing channel
        existingChannel.name = channelData.name;
        existingChannel.isTracking = true;
        existingChannel.lastTrendingDate = new Date();
        existingChannel.monitoringTier = channelData.monitoringTier || 1;
        existingChannel.metrics = channelData.metrics;
        
        await existingChannel.save();
        return existingChannel;
    }
    
    // Create new channel
    const newChannel = new Channel({
        channelId: channelData.channelId,
        name: channelData.name,
        isTracking: true,
        lastTrendingDate: new Date(),
        monitoringTier: channelData.monitoringTier || 1,
        metrics: channelData.metrics,
        metricsHistory: []
    });
    
    await newChannel.save();
    console.log(`Started tracking new channel: ${channelData.name}`);
    return newChannel;
}