/**
 * MongoDB Database Module
 * Replaces SQLite for Vercel deployment
 * Connection: MongoDB Atlas
 */

const { MongoClient, ObjectId } = require('mongodb');

// Helper: convert HH:MM to minutes
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours * 60) + minutes;
}

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
        'streaks',
        'life_score_history',
        'weekly_stats',
        'settings_history'
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

        // life score history
        await db.collection('life_score_history').createIndex({ date: 1 }, { unique: true });

        // settings
        await db.collection('settings').createIndex({ key: 1 }, { unique: true });
        await db.collection('settings_history').createIndex({ changed_at: -1 });

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

async function getDayLog(date) {
    const logDate = date || new Date().toISOString().split('T')[0];
    let log = await db.collection('daily_logs').findOne({ date: logDate });
    if (!log) {
        log = await createEmptyLog(logDate);
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

// Backwards compatibility wrapper
async function saveDayLog(data) {
    return saveTodayLog(data);
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

async function getTasksForDate(date) {
    const tasks = await db.collection('tasks')
        .find({ date })
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
// APP SETTINGS (key/value)
// ============================================

async function getSetting(key) {
    const doc = await db.collection('settings').findOne({ key });
    return doc?.value || null;
}

async function setSetting(key, value) {
    await db.collection('settings').updateOne(
        { key },
        { $set: { key, value, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
        { upsert: true }
    );
    return { key, value };
}

async function getSettingsHistory(limit = 50) {
    return db.collection('settings_history')
        .find({})
        .sort({ changed_at: -1 })
        .limit(limit)
        .toArray();
}

async function logSettingsChange(path, oldValue, newValue, reason = '') {
    await db.collection('settings_history').insertOne({
        path,
        old_value: oldValue,
        new_value: newValue,
        reason,
        changed_at: new Date(),
    });
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
// LIFE SCORE OPERATIONS
// ============================================

async function calculateAndSaveLifeScore(date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const dayLog = await getDayLog(targetDate);
    const streaks = await getAllStreaks();

    let learningComponent = 0;
    let workoutComponent = 0;
    let sleepComponent = 0;
    let screenComponent = 0;
    let mitComponent = 0;
    let streakBonus = 0;
    let penalty = 0;

    // Learning (max 30)
    if (dayLog.learning_done) {
        learningComponent = Math.min((dayLog.learning_hours || 0) * 10, 30);
    }

    // Workout (max 20)
    if (dayLog.workout_done) {
        workoutComponent = 20;
    }

    // Sleep (max 20) using target 05:45
    if (dayLog.wakeup_time) {
        const wakeMinutes = timeToMinutes(dayLog.wakeup_time);
        const targetMinutes = timeToMinutes('05:45');
        if (wakeMinutes <= targetMinutes) sleepComponent = 20;
        else if (wakeMinutes <= targetMinutes + 30) sleepComponent = 15;
        else if (wakeMinutes <= targetMinutes + 60) sleepComponent = 10;
        else sleepComponent = 5;
    }

    // Screen time (max 15)
    if (dayLog.screen_time !== undefined && dayLog.screen_time !== null) {
        if (dayLog.screen_time < 2) screenComponent = 15;
        else if (dayLog.screen_time < 3) screenComponent = 12;
        else if (dayLog.screen_time < 4) screenComponent = 8;
        else if (dayLog.screen_time < 5) screenComponent = 4;
        else {
            screenComponent = 0;
            penalty += 5;
        }
    }

    // MITs (max 15)
    const mitsCompleted = (dayLog.mit_1_done ? 1 : 0) + (dayLog.mit_2_done ? 1 : 0) + (dayLog.mit_3_done ? 1 : 0);
    mitComponent = mitsCompleted * 5;

    // Streak bonuses (max 10)
    Object.values(streaks || {}).forEach((streak) => {
        if (streak.current_count >= 7) streakBonus += 2.5;
        else if (streak.current_count >= 3) streakBonus += 1;
    });
    streakBonus = Math.min(streakBonus, 10);

    // Penalties for broken streaks
    Object.values(streaks || {}).forEach((streak) => {
        if (streak.broken_at && streak.recovery_days > 0) {
            penalty += 3;
        }
    });

    const rawScore = learningComponent + workoutComponent + sleepComponent + screenComponent + mitComponent + streakBonus - penalty;
    const score = Math.max(0, Math.min(100, rawScore));

    // Upsert life score history
    await db.collection('life_score_history').updateOne(
        { date: targetDate },
        {
            $set: {
                score,
                learning_component: learningComponent,
                workout_component: workoutComponent,
                sleep_component: sleepComponent,
                screen_component: screenComponent,
                mit_component: mitComponent,
                streak_bonus: streakBonus,
                penalty,
                updated_at: new Date(),
            },
            $setOnInsert: { created_at: new Date() },
        },
        { upsert: true }
    );

    // Update daily log with score
    await db.collection('daily_logs').updateOne(
        { date: targetDate },
        { $set: { life_score: score, updated_at: new Date() } }
    );

    return {
        score,
        breakdown: {
            learning: learningComponent,
            workout: workoutComponent,
            sleep: sleepComponent,
            screen: screenComponent,
            mit: mitComponent,
            streakBonus,
            penalty,
        },
    };
}

async function getLifeScoreHistory(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    return db.collection('life_score_history')
        .find({ date: { $gte: startDateStr } })
        .sort({ date: -1 })
        .toArray();
}

// ============================================
// ANALYTICS OPERATIONS
// ============================================

async function getWeeklyHistory(weeks = 12) {
    // Placeholder: compute simple weekly buckets from daily_logs
    const days = weeks * 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const logs = await db.collection('daily_logs')
        .find({ date: { $gte: startDateStr } })
        .sort({ date: 1 })
        .toArray();

    const weekly = [];
    const bucket = {};
    logs.forEach((log) => {
        const d = new Date(log.date);
        const year = d.getUTCFullYear();
        const week = Math.floor(((d - new Date(Date.UTC(year, 0, 1))) / 86400000 + new Date(Date.UTC(year, 0, 1)).getUTCDay()) / 7);
        const key = `${year}-W${week}`;
        if (!bucket[key]) {
            bucket[key] = { key, logs: [], total_learning_hours: 0, gym_sessions: 0, days_tracked: 0 };
        }
        bucket[key].logs.push(log);
        bucket[key].total_learning_hours += log.learning_hours || 0;
        bucket[key].gym_sessions += log.workout_done ? 1 : 0;
        bucket[key].days_tracked += 1;
    });

    Object.values(bucket).forEach((w) => weekly.push(w));
    weekly.sort((a, b) => (a.key < b.key ? 1 : -1));
    return weekly;
}

async function getAnalyticsData(days = 30) {
    const history = await getHistory(days);
    const weeklyHistory = await getWeeklyHistory(Math.ceil(days / 7));
    const lifeScoreHistory = await getLifeScoreHistory(days);

    return {
        daily: history,
        weekly: weeklyHistory,
        lifeScores: lifeScoreHistory,
    };
}

// ============================================
// MIGRATION (no-op for MongoDB)
// ============================================

async function migrateFromLocalStorage(payload) {
    // Stub for compatibility
    await setSetting('migrated_from_localstorage', new Date().toISOString());
    return { success: true, message: 'Migration not required for MongoDB backend.' };
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
    getDayLog,
    saveTodayLog,
    saveDayLog,
    getHistory,
    createEmptyLog,

    // Tasks
    getTodayTasks,
    getTasksForDate,
    createTask,
    updateTask,
    deleteTask,

    // Streaks
    getAllStreaks,
    updateStreak,

    // Settings
    getSystemSettings,
    saveSystemSettings,
    getSetting,
    setSetting,
    getSettingsHistory,
    logSettingsChange,

    // Analytics
    calculateAndSaveLifeScore,
    getLifeScoreHistory,
    getWeeklyHistory,
    getAnalyticsData,
    getAnalytics,
    getStats,
    getCurrentWeekStats,
    getProjectStats,
    getTotalSkillHours,

    // Migration
    migrateFromLocalStorage
};
