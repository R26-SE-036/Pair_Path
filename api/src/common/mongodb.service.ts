import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, Db } from 'mongodb';

@Injectable()
export class MongoDbService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient;
  private db: Db;
  private dbName = 'pairprogramming_ml';
  private warned = false;

  async onModuleInit() {
    try {
      const uri = process.env.MONGODB_URI //|| 'mongodb://localhost:27017';
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      console.log('MongoDB connected successfully');
    } catch (error) {
      console.error('MongoDB connection error:', error);
    }
  }

  /**
   * Mongo holds the research/analytics trail only. When it is unavailable the
   * session must keep running — a logging outage must never take down the
   * live prediction/intervention path with it.
   */
  private collection(name: string) {
    if (!this.db) {
      if (!this.warned) {
        console.warn(
          `MongoDB unavailable — analytics logging disabled for this run. ` +
            `Sessions and interventions continue normally.`,
        );
        this.warned = true;
      }
      return null;
    }
    return this.db.collection(name);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      console.log('MongoDB disconnected');
    }
  }

  // ML event logging
  async logMLEvent(sessionId: string, event: any): Promise<void> {
    const collection = this.collection('ml_events');
    if (!collection) return;
    const logEntry = {
      timestamp: new Date(),
      sessionId,
      ...event
    };
    await collection.insertOne(logEntry);
  }

  async getSessionMLEvents(sessionId: string, limit: number = 100): Promise<any[]> {
    const collection = this.collection('ml_events');
    if (!collection) return [];
    return await collection.find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  // Feature data storage for training
  async storeSessionFeatures(sessionId: string, features: any): Promise<void> {
    const collection = this.collection('session_features');
    if (!collection) return;
    const featureEntry = {
      sessionId,
      features,
      timestamp: new Date(),
      extractedAt: new Date()
    };
    await collection.updateOne(
      { sessionId },
      { $set: featureEntry },
      { upsert: true }
    );
  }

  async getSessionFeatures(sessionId: string): Promise<any> {
    const collection = this.collection('session_features');
    if (!collection) return null;
    const result = await collection.findOne({ sessionId });
    return result ? result.features : null;
  }

  // Model performance tracking
  async logModelPerformance(modelVersion: string, metrics: any): Promise<void> {
    const collection = this.collection('model_performance');
    if (!collection) return;
    const performanceEntry = {
      modelVersion,
      metrics,
      timestamp: new Date()
    };
    await collection.insertOne(performanceEntry);
  }

  async getModelPerformanceHistory(limit: number = 50): Promise<any[]> {
    const collection = this.collection('model_performance');
    if (!collection) return [];
    return await collection.find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  // Intervention tracking
  async logIntervention(sessionId: string, intervention: any): Promise<void> {
    const collection = this.collection('interventions');
    if (!collection) return;
    const interventionEntry = {
      sessionId,
      intervention,
      timestamp: new Date()
    };
    await collection.insertOne(interventionEntry);
  }

  async getSessionInterventions(sessionId: string): Promise<any[]> {
    const collection = this.collection('interventions');
    if (!collection) return [];
    return await collection.find({ sessionId })
      .sort({ timestamp: -1 })
      .toArray();
  }

  // Training data management
  async storeTrainingData(trainingData: any[]): Promise<void> {
    const collection = this.collection('training_data');
    if (!collection) return;
    const dataEntry = {
      data: trainingData,
      timestamp: new Date(),
      version: 'v1.0'
    };
    await collection.insertOne(dataEntry);
  }

  async getTrainingData(version?: string): Promise<any> {
    const collection = this.collection('training_data');
    if (!collection) return null;
    const query = version ? { version } : {};
    const result = await collection.findOne(query, { sort: { timestamp: -1 } });
    return result ? result.data : null;
  }

  // Analytics and reporting
  async getCollaborationStats(timeRange: { start: Date, end: Date }): Promise<any> {
    const collection = this.collection('ml_events');
    if (!collection) return { totalSessions: 0, avgConfidence: 0, totalInterventions: 0 };
    const pipeline = [
      {
        $match: {
          timestamp: { $gte: timeRange.start, $lte: timeRange.end }
        }
      },
      {
        $group: {
          _id: '$sessionId',
          totalEvents: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' },
          interventionCount: { $sum: { $cond: [{ $gt: ['$interventionType', null] }, 1, 0] } }
        }
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: '$totalEvents' },
          avgConfidence: { $avg: '$avgConfidence' },
          totalInterventions: { $sum: '$interventionCount' }
        }
      }
    ];
    
    const result = await collection.aggregate(pipeline).toArray();
    return result.length > 0 ? result[0] : {
      totalSessions: 0,
      avgConfidence: 0,
      totalInterventions: 0
    };
  }
}
