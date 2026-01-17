/**
 * Express API Server
 * Productivity Command Center Backend
 */

// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// Use MongoDB for production (Vercel), SQLite for development
const db = process.env.MONGODB_URI 
    ? require('./database-mongodb')
    : require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Request logging (development)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// TODAY/DAILY LOG ENDPOINTS
// ============================================

/**
 * GET /api/today
 * Get today's log data
 */
app.get('/api/today', async (req, res) => {
    try {
        const todayLog = await db.getTodayLog();
        const tasks = await db.getTodayTasks();
        const streaks = await db.getAllStreaks();
        const weekStats = await db.getCurrentWeekStats();
        const projectStats = await db.getProjectStats();
        const totalSkillHours = await db.getTotalSkillHours();
        
        // Check for day transition on each request
        await db.checkStreakDayTransition();
        
        // Calculate life score
        const lifeScore = await db.calculateAndSaveLifeScore();
        
        res.json({
            today: todayLog || {},
            tasks: tasks,
            streaks: streaks,
            weekStats: weekStats || {},
            projectStats: projectStats,
            totalSkillHours: totalSkillHours,
            lifeScore: lifeScore
        });
    } catch (err) {
        console.error('Error fetching today data:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/today
 * Save/update today's log data
 */
app.post('/api/today', async (req, res) => {
    try {
        const result = await db.saveDayLog(req.body);
        
        // Recalculate life score after saving
        const lifeScore = await db.calculateAndSaveLifeScore();
        
        // Get updated week stats
        const weekStats = await db.getCurrentWeekStats();
        
        res.json({
            success: true,
            ...result,
            lifeScore: lifeScore,
            weekStats: weekStats
        });
    } catch (err) {
        console.error('Error saving today data:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/day/:date
 * Get log for a specific date
 */
app.get('/api/day/:date', async (req, res) => {
    try {
        const log = await db.getDayLog(req.params.date);
        const tasks = await db.getTasksForDate(req.params.date);
        res.json({ log: log || {}, tasks: tasks });
    } catch (err) {
        console.error('Error fetching day data:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// HISTORY ENDPOINTS
// ============================================

/**
 * GET /api/history/:days
 * Get history for last N days
 */
app.get('/api/history/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days) || 30;
        const history = await db.getHistory(days);
        res.json({ history: history });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/history
 * Get history for last 30 days (default)
 */
app.get('/api/history', async (req, res) => {
    try {
        const history = await db.getHistory(30);
        res.json({ history: history });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/history/range/:start/:end
 * Get history between dates
 */
app.get('/api/history/range/:start/:end', async (req, res) => {
    try {
        const history = await db.getHistoryRange(req.params.start, req.params.end);
        res.json({ history: history });
    } catch (err) {
        console.error('Error fetching history range:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// WEEKLY STATS ENDPOINTS
// ============================================

/**
 * GET /api/week/current
 * Get current week's stats
 */
app.get('/api/week/current', async (req, res) => {
    try {
        const weekStats = await db.getCurrentWeekStats();
        const weekStart = db.getWeekStart(new Date());
        const weekEnd = db.getWeekEnd(new Date());
        
        // Get daily breakdown for the week
        const weekDays = await db.getHistoryRange(weekStart, weekEnd);
        
        res.json({
            stats: weekStats || {
                total_learning_hours: 0,
                gym_sessions: 0,
                avg_screen_time: 0,
                days_tracked: 0,
                consistency_score: 0
            },
            weekStart: weekStart,
            weekEnd: weekEnd,
            days: weekDays,
            targets: {
                learning: 20,
                gym: 5
            }
        });
    } catch (err) {
        console.error('Error fetching current week:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/week/:weekStart
 * Get stats for a specific week
 */
app.get('/api/week/:weekStart', async (req, res) => {
    try {
        const weekStats = await db.getWeekStats(req.params.weekStart);
        const weekEnd = db.getWeekEnd(req.params.weekStart);
        const weekDays = await db.getHistoryRange(req.params.weekStart, weekEnd);
        
        res.json({
            stats: weekStats || {},
            weekStart: req.params.weekStart,
            weekEnd: weekEnd,
            days: weekDays
        });
    } catch (err) {
        console.error('Error fetching week:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/weeks/:count
 * Get multiple weeks of stats
 */
app.get('/api/weeks/:count', async (req, res) => {
    try {
        const count = parseInt(req.params.count) || 12;
        const weeklyHistory = await db.getWeeklyHistory(count);
        res.json({ weeks: weeklyHistory });
    } catch (err) {
        console.error('Error fetching weeks:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// STREAK ENDPOINTS
// ============================================

/**
 * GET /api/streaks
 * Get all streaks
 */
app.get('/api/streaks', async (req, res) => {
    try {
        const streaks = await db.getAllStreaks();
        res.json({ streaks: streaks });
    } catch (err) {
        console.error('Error fetching streaks:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/streaks/:type
 * Update a specific streak
 */
app.put('/api/streaks/:type', async (req, res) => {
    try {
        const result = await db.updateStreak(req.params.type, req.body);
        res.json({ success: true, streak: result });
    } catch (err) {
        console.error('Error updating streak:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/streaks/:type/increment
 * Increment a streak
 */
app.post('/api/streaks/:type/increment', async (req, res) => {
    try {
        const result = await db.incrementStreak(req.params.type);
        res.json({ success: true, streak: result });
    } catch (err) {
        console.error('Error incrementing streak:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/streaks/:type/break
 * Break a streak
 */
app.post('/api/streaks/:type/break', async (req, res) => {
    try {
        const result = await db.breakStreak(req.params.type);
        res.json({ success: true, streak: result });
    } catch (err) {
        console.error('Error breaking streak:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PROJECT ENDPOINTS
// ============================================

/**
 * GET /api/projects
 * Get all projects
 */
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await db.getAllProjects();
        const stats = await db.getProjectStats();
        res.json({ projects: projects, stats: stats });
    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/projects
 * Add a project
 */
app.post('/api/projects', async (req, res) => {
    try {
        const { name, hours, status } = req.body;
        const result = await db.addProject(name, hours, status);
        const stats = await db.getProjectStats();
        res.json({ success: true, project: result, stats: stats });
    } catch (err) {
        console.error('Error adding project:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const result = await db.deleteProject(req.params.id);
        const stats = await db.getProjectStats();
        res.json({ success: true, ...result, stats: stats });
    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TASK ENDPOINTS
// ============================================

/**
 * GET /api/tasks
 * Get today's tasks
 */
app.get('/api/tasks', async (req, res) => {
    try {
        const tasks = await db.getTodayTasks();
        res.json({ tasks: tasks });
    } catch (err) {
        console.error('Error fetching tasks:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/tasks/:date
 * Get tasks for a specific date
 */
app.get('/api/tasks/:date', async (req, res) => {
    try {
        const tasks = await db.getTasksForDate(req.params.date);
        res.json({ tasks: tasks });
    } catch (err) {
        console.error('Error fetching tasks:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/tasks
 * Add a task
 */
app.post('/api/tasks', async (req, res) => {
    try {
        const { text, date } = req.body;
        const result = await db.addTask(text, date);
        res.json({ success: true, task: result });
    } catch (err) {
        console.error('Error adding task:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/tasks/:id
 * Update a task
 */
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const result = await db.updateTask(req.params.id, req.body);
        res.json({ success: true, task: result });
    } catch (err) {
        console.error('Error updating task:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task
 */
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const result = await db.deleteTask(req.params.id);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Error deleting task:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// LIFE SCORE ENDPOINTS
// ============================================

/**
 * GET /api/lifescore
 * Get current life score
 */
app.get('/api/lifescore', async (req, res) => {
    try {
        const lifeScore = await db.calculateAndSaveLifeScore();
        res.json(lifeScore);
    } catch (err) {
        console.error('Error calculating life score:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/lifescore/history/:days
 * Get life score history
 */
app.get('/api/lifescore/history/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days) || 30;
        const history = await db.getLifeScoreHistory(days);
        res.json({ history: history });
    } catch (err) {
        console.error('Error fetching life score history:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

/**
 * GET /api/analytics/:period
 * Get analytics data for a period
 */
app.get('/api/analytics/:period', async (req, res) => {
    try {
        const period = parseInt(req.params.period) || 30;
        const data = await db.getAnalyticsData(period);
        res.json(data);
    } catch (err) {
        console.error('Error fetching analytics:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/analytics
 * Get analytics data (default 30 days)
 */
app.get('/api/analytics', async (req, res) => {
    try {
        const data = await db.getAnalyticsData(30);
        res.json(data);
    } catch (err) {
        console.error('Error fetching analytics:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/skill-hours
 * Get total skill hours
 */
app.get('/api/skill-hours', async (req, res) => {
    try {
        const total = await db.getTotalSkillHours();
        res.json({ total: total });
    } catch (err) {
        console.error('Error fetching skill hours:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// MIGRATION ENDPOINT
// ============================================

/**
 * POST /api/migrate
 * Migrate data from localStorage
 */
app.post('/api/migrate', async (req, res) => {
    try {
        const result = await db.migrateFromLocalStorage(req.body);
        res.json(result);
    } catch (err) {
        console.error('Error during migration:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/migration-status
 * Check if migration has been done
 */
app.get('/api/migration-status', async (req, res) => {
    try {
        const migrated = await db.getSetting('migrated_from_localstorage');
        res.json({ migrated: !!migrated, migratedAt: migrated });
    } catch (err) {
        console.error('Error checking migration status:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// SETTINGS ENDPOINTS
// ============================================

/**
 * GET /api/settings/:key
 * Get a setting
 */
app.get('/api/settings/:key', async (req, res) => {
    try {
        const value = await db.getSetting(req.params.key);
        res.json({ key: req.params.key, value: value });
    } catch (err) {
        console.error('Error fetching setting:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/settings/:key
 * Set a setting
 */
app.put('/api/settings/:key', async (req, res) => {
    try {
        const result = await db.setSetting(req.params.key, req.body.value);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Error saving setting:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// SETTINGS AUTHORITY ENDPOINTS
// ============================================

/**
 * GET /api/system-settings
 * Get current system settings
 */
app.get('/api/system-settings', async (req, res) => {
    try {
        const settings = await db.getSystemSettings();
        const history = await db.getSettingsHistory(50);
        res.json({ 
            settings: settings?.settings || null,
            effectiveFrom: settings?.effectiveFrom,
            history: history
        });
    } catch (err) {
        console.error('Error fetching system settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/system-settings
 * Save system settings
 */
app.post('/api/system-settings', async (req, res) => {
    try {
        const result = await db.saveSystemSettings(req.body.settings);
        
        // Log individual changes if provided
        if (req.body.changes && Array.isArray(req.body.changes)) {
            for (const change of req.body.changes) {
                await db.logSettingsChange(
                    change.path,
                    change.oldValue,
                    change.newValue,
                    change.reason
                );
            }
        }
        
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Error saving system settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/settings-history
 * Get settings change history
 */
app.get('/api/settings-history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = await db.getSettingsHistory(limit);
        res.json({ history });
    } catch (err) {
        console.error('Error fetching settings history:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// DAY STATE MANAGEMENT ENDPOINTS
// ============================================

/**
 * POST /api/day/:date/lock
 * Lock/finalize a day
 */
app.post('/api/day/:date/lock', async (req, res) => {
    try {
        const { date } = req.params;
        const { state, finalScore } = req.body;
        
        const result = await db.lockDay(date, state, finalScore);
        await db.logDayStateTransition(date, 'open', state, 'Manual lock', false);
        
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Error locking day:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/day/:date/skip
 * Skip a day
 */
app.post('/api/day/:date/skip', async (req, res) => {
    try {
        const { date } = req.params;
        const { reason } = req.body;
        
        const result = await db.skipDay(date, reason);
        await db.logDayStateTransition(date, null, 'skipped', reason, false);
        
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Error skipping day:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/day/:date/state-log
 * Get state transitions for a day
 */
app.get('/api/day/:date/state-log', async (req, res) => {
    try {
        const log = await db.getDayStateLog(req.params.date);
        res.json({ log });
    } catch (err) {
        console.error('Error fetching state log:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/days-by-state
 * Get days grouped by state for a period
 */
app.get('/api/days-by-state', async (req, res) => {
    try {
        const { start, end } = req.query;
        const days = await db.getDaysByState(start, end);
        res.json({ days });
    } catch (err) {
        console.error('Error fetching days by state:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/close-days
 * Close all unlocked days before a date
 */
app.post('/api/close-days', async (req, res) => {
    try {
        const { beforeDate } = req.body;
        const unlockedDays = await db.getUnlockedDays(beforeDate);
        
        const results = [];
        for (const day of unlockedDays) {
            // Calculate state based on data
            const state = day.learning_done || day.workout_done ? 'partial' : 'missed';
            const score = day.life_score || 0;
            
            await db.lockDay(day.date, state, score);
            await db.logDayStateTransition(day.date, 'open', state, 'Auto-close', true);
            results.push({ date: day.date, state });
        }
        
        res.json({ success: true, closedDays: results.length, results });
    } catch (err) {
        console.error('Error closing days:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fill-missed-days
 * Fill in missed days with empty entries
 */
app.post('/api/fill-missed-days', async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const existingDays = await db.getDaysByState(startDate, endDate);
        const existingDates = new Set(existingDays.map(d => d.date));
        
        const created = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        while (start < end) {
            const dateStr = start.toISOString().split('T')[0];
            if (!existingDates.has(dateStr)) {
                await db.createMissedDay(dateStr);
                await db.logDayStateTransition(dateStr, null, 'missed', 'Gap fill', true);
                created.push(dateStr);
            }
            start.setDate(start.getDate() + 1);
        }
        
        res.json({ success: true, createdDays: created.length, dates: created });
    } catch (err) {
        console.error('Error filling missed days:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// RESET ENDPOINT (Dev only)
// ============================================
app.post('/api/reset', async (req, res) => {
    try {
        console.log('Reset endpoint called - clearing all data...');
        
        const result = await db.clearAllData();
        
        console.log('Reset complete - all data cleared');
        res.json({ success: true, message: 'All data reset', details: result });
    } catch (err) {
        console.error('Reset error:', err);
        res.status(500).json({ error: 'Failed to reset data', message: err.message });
    }
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// SERVER STARTUP
// ============================================

async function startServer() {
    try {
        // Initialize database
        await db.initDatabase();
        console.log('Database initialized');
        
        // Start server
        app.listen(PORT, () => {
            console.log(`\n🚀 Productivity Command Center API running at http://localhost:${PORT}`);
            console.log(`📊 Dashboard available at http://localhost:${PORT}/index.html`);
            console.log(`\nAPI Endpoints:`);
            console.log(`  GET  /api/today           - Get today's data`);
            console.log(`  POST /api/today           - Save today's data`);
            console.log(`  GET  /api/week/current    - Get current week stats`);
            console.log(`  GET  /api/history/:days   - Get history`);
            console.log(`  GET  /api/analytics/:days - Get analytics data`);
            console.log(`  POST /api/migrate         - Migrate from localStorage`);
            console.log(`\nPress Ctrl+C to stop\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await db.closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await db.closeDatabase();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
