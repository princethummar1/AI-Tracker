/**
 * MongoDB Database Module
 * Replaces SQLite for Vercel deployment
 * Connection: MongoDB Atlas
 */

const { MongoClient, ObjectId } = require('mongodb');

// MongoDB connection
let client = null;
let db = null;

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-tracker';
const DB_NAME = 'ai-tracker';

/**
 * Initialize MongoDB connection
 */
async function initDatabase() {
    try {
        client = new MongoClient(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        await client.connect();
        db = client.db(DB_NAME);

        console.log('Connected to MongoDB Atlas');

        // Create collections if they don't exist
        await createCollections();
        await createIndexes();
        await initializeDefaults();

        return true;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

/**
 * Create collections
 */
async function createCollections() {
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    const requiredCollections = [
        'daily_logs',
        'tasks',
        'settings',
        'system_settings',
        'projects',
        'streaks'
    ];

    for (const collName of requiredCollections) {
        if (!collectionNames.includes(collName)) {
            await db.createCollection(collName);
            console.log(`Created collection: ${collName}`);
        }
    }
}

/**
 * Create indexes for better performance
 */
async function createIndexes() {
    try {
        // daily_logs indexes
        await db.collection('daily_logs').createIndex({ date: 1 }, { unique: true });
        await db.collection('daily_logs').createIndex({ locked_at: 1 });

        // tasks indexes
        await db.collection('tasks').createIndex({ date: 1 });
        await db.collection('tasks').createIndex({ completed: 1 });

        // streaks indexes
        await db.collection('streaks').createIndex({ habitName: 1 }, { unique: true });

        console.log('Indexes created successfully');
    } catch (error) {
        console.error('Index creation error:', error);
    }
}

/**
 * Initialize default documents
 */
async function initializeDefaults() {
    try {
        // Check if default settings exist
        const existingSettings = await db.collection('system_settings').findOne({});
        if (!existingSettings) {
            const defaultSettings = {
                _id: 'main',
                day_cutoff: '05:00',
                habit_toggles: {
                    learning: true,
                    workout: true,
                    wakeup: true,
                    screentime: true
                },
                non_negotiables: {
                    learning: true,
                    workout: true
                },
                streak_sensitivity: 'medium',
                weekly_targets: {
                    learning_hours: 14,
                    gym_sessions: 4
                },
                allow_skips: false,
                skip_days_remaining: 0,
                created_at: new Date(),
                updated_at: new Date()
            };

            await db.collection('system_settings').insertOne(defaultSettings);
            console.log('Default settings initialized');
        }
    } catch (error) {
        console.error('Default initialization error:', error);
    }
}

// ============================================
// DAILY LOGS FUNCTIONS
// ============================================

async function getTodayLog() {
    const today = new Date().toISOString().split('T')[0];
    let log = await db.collection('daily_logs').findOne({ date: today });

    if (!log) {
        log = await createEmptyLog(today);
    }

    return log;
}

async function createEmptyLog(date) {
    const newLog = {
        date,
        wakeup_time: null,
        learning_done: false,
        learning_hours: 0,
        learned_today: '',
        workout_done: false,
        workout_type: 'gym',
        screen_time: 0,
        mood: null,
        mit_1_text: 'MIT 1',
        mit_1_done: false,
        mit_2_text: 'MIT 2',
        mit_2_done: false,
        mit_3_text: 'MIT 3',
        mit_3_done: false,
        bedtime: null,
        life_score: 0,
        productivity_score: 0,
        day_state: 'open',
        locked: false,
        locked_at: null,
        finalized: false,
        finalized_at: null,
        created_at: new Date(),
        updated_at: new Date()
    };

    await db.collection('daily_logs').insertOne(newLog);
    return newLog;
}

async function saveTodayLog(data) {
    const today = new Date().toISOString().split('T')[0];

    const updateData = {
        ...data,
        updated_at: new Date()
    };

    const result = await db.collection('daily_logs').updateOne(
        { date: today },
        { $set: updateData },
        { upsert: true }
    );

    return result;
}

async function getHistory(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const history = await db.collection('daily_logs')
        .find({ date: { $gte: startDateStr } })
        .sort({ date: -1 })
        .toArray();

    return history;
}

// ============================================
// TASKS FUNCTIONS
// ============================================

async function getTodayTasks() {
    const today = new Date().toISOString().split('T')[0];

    const tasks = await db.collection('tasks')
        .find({ date: today })
        .sort({ created_at: -1 })
        .toArray();

    return tasks;
}

async function createTask(name, priority = 'medium', category = 'general') {
    const today = new Date().toISOString().split('T')[0];

    const newTask = {
        date: today,
        name,
        priority,
        category,
        completed: false,
        created_at: new Date(),
        updated_at: new Date()
    };

    const result = await db.collection('tasks').insertOne(newTask);
    return result;
}

async function updateTask(taskId, updateData) {
    const result = await db.collection('tasks').updateOne(
        { _id: new ObjectId(taskId) },
        { $set: { ...updateData, updated_at: new Date() } }
    );

    return result;
}

async function deleteTask(taskId) {
    const result = await db.collection('tasks').deleteOne(
        { _id: new ObjectId(taskId) }
    );

    return result;
}

// ============================================
// STREAKS FUNCTIONS
// ============================================

async function getAllStreaks() {
    const streaks = await db.collection('streaks').find({}).toArray();

    return streaks.reduce((acc, streak) => {
        acc[streak.habitName] = streak;
        return acc;
    }, {});
}

async function updateStreak(habitName, count, lastDate) {
    const result = await db.collection('streaks').updateOne(
        { habitName },
        {
            $set: {
                count,
                lastDate,
                updated_at: new Date()
            }
        },
        { upsert: true }
    );

    return result;
}

// ============================================
// SETTINGS FUNCTIONS
// ============================================

async function getSystemSettings() {
    let settings = await db.collection('system_settings').findOne({ _id: 'main' });

    if (!settings) {
        await initializeDefaults();
        settings = await db.collection('system_settings').findOne({ _id: 'main' });
    }

    return settings;
}

async function saveSystemSettings(data) {
    const result = await db.collection('system_settings').updateOne(
        { _id: 'main' },
        {
            $set: {
                ...data,
                updated_at: new Date()
            }
        },
        { upsert: true }
    );

    return result;
}

// ============================================
// ANALYTICS FUNCTIONS
// ============================================

async function getAnalytics(period = '7days') {
    let days = 7;

    switch (period) {
        case '14days':
            days = 14;
            break;
        case '30days':
            days = 30;
            break;
        case '90days':
            days = 90;
            break;
        case 'alltime':
            days = 365 * 5; // 5 years
            break;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const logs = await db.collection('daily_logs')
        .find({
            date: { $gte: startDateStr },
            finalized: true
        })
        .sort({ date: 1 })
        .toArray();

    return {
        period,
        days,
        logs,
        count: logs.length
    };
}

async function getStats() {
    const logs = await db.collection('daily_logs')
        .find({ finalized: true })
        .toArray();

    const totalDays = logs.length;
    const avgLifeScore = logs.length > 0
        ? logs.reduce((sum, log) => sum + (log.life_score || 0), 0) / logs.length
        : 0;

    const avgLearning = logs.length > 0
        ? logs.reduce((sum, log) => sum + (log.learning_hours || 0), 0) / logs.length
        : 0;

    return {
        total_days: totalDays,
        avg_life_score: Math.round(avgLifeScore * 100) / 100,
        avg_learning_hours: Math.round(avgLearning * 100) / 100
    };
}

async function getCurrentWeekStats() {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const weekLogs = await db.collection('daily_logs')
        .find({ date: { $gte: weekStartStr } })
        .sort({ date: 1 })
        .toArray();

    return {
        week_start: weekStartStr,
        logs: weekLogs,
        total_learning_hours: weekLogs.reduce((sum, log) => sum + (log.learning_hours || 0), 0),
        total_workout_days: weekLogs.filter(log => log.workout_done).length
    };
}

async function getProjectStats() {
    return {};
}

async function getTotalSkillHours() {
    const logs = await db.collection('daily_logs')
        .find({ learning_done: true })
        .toArray();

    const totalHours = logs.reduce((sum, log) => sum + (log.learning_hours || 0), 0);

    return Math.round(totalHours * 100) / 100;
}

// ============================================
// DATABASE MANAGEMENT
// ============================================

async function closeDatabase() {
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
    }
}

// Export all functions
module.exports = {
    // Connection
    initDatabase,
    closeDatabase,

    // Daily logs
    getTodayLog,
    saveTodayLog,
    getHistory,
    createEmptyLog,

    // Tasks
    getTodayTasks,
    createTask,
    updateTask,
    deleteTask,

    // Streaks
    getAllStreaks,
    updateStreak,

    // Settings
    getSystemSettings,
    saveSystemSettings,

    // Analytics
    getAnalytics,
    getStats,
    getCurrentWeekStats,
    getProjectStats,
    getTotalSkillHours
};
