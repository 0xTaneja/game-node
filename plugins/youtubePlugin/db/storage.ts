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
      // Connect to the main URI but ensure we're using the youtube_monitor database
      await connect(MONGODB_URI);
      
      // Explicitly set the database to use
      mongoose.connection.useDb(MONGODB_DB_NAME, { useCache: true });
      
      isConnected = true;
      console.log(`MongoDB connected successfully to database: ${MONGODB_DB_NAME}`);
    }
    catch(error){
     console.error('MongoDB Connection Error :',error);
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

export async function updateChannelMetrics(channelId:string,metrics:ChannelMetrics) : Promise<IChannel | null> {
    await connectDB();

    const channel = await Channel.findOne({channelId});

    if(!channel)
        return null;

    if(!channel.metricsHistory){
        channel.metricsHistory = [];
    }

    if(channel.metricsHistory.length >= 30)
    {
        channel.metricsHistory.shift();
    }

    channel.metricsHistory.push(channel.metrics);

    channel.metrics = metrics;

    await channel.save();
    return channel;
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