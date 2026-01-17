/**
 * Database Module - SQLite Setup & Queries
 * Productivity Command Center
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database file location
const DB_PATH = path.join(__dirname, 'data', 'productivity.db');

// Schema version for migrations
const SCHEMA_VERSION = 2;  // Upgraded for settings authority system

let db = null;

/**
 * Initialize the database connection and create tables
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        // Ensure data directory exists
        const fs = require('fs');
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Failed to connect to database:', err);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database');
            
            // Enable foreign keys and WAL mode for better performance
            db.run('PRAGMA foreign_keys = ON');
            db.run('PRAGMA journal_mode = WAL');
            
            createTables()
                .then(() => runMigrations())
                .then(() => initializeDefaults())
                .then(resolve)
                .catch(reject);
        });
    });
}

/**
 * Create all necessary tables
 */
function createTables() {
    return new Promise((resolve, reject) => {
        const schema = `
            -- Daily logs table (with day state support)
            CREATE TABLE IF NOT EXISTS daily_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                wakeup_time TEXT,
                learning_done INTEGER DEFAULT 0,
                learning_hours REAL DEFAULT 0,
                learned_today TEXT,
                workout_done INTEGER DEFAULT 0,
                workout_type TEXT DEFAULT 'gym',
                screen_time REAL DEFAULT 0,
                mood INTEGER,
                mit_1_text TEXT,
                mit_1_done INTEGER DEFAULT 0,
                mit_2_text TEXT,
                mit_2_done INTEGER DEFAULT 0,
                mit_3_text TEXT,
                mit_3_done INTEGER DEFAULT 0,
                bedtime TEXT,
                life_score REAL,
                productivity_score REAL,
                -- Day State Fields (new)
                day_state TEXT DEFAULT 'open',
                locked INTEGER DEFAULT 0,
                locked_at TEXT,
                final_score REAL,
                skipped INTEGER DEFAULT 0,
                skip_reason TEXT,
                completion_percent REAL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Weekly aggregates table
            CREATE TABLE IF NOT EXISTS weekly_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start TEXT UNIQUE NOT NULL,
                week_end TEXT NOT NULL,
                total_learning_hours REAL DEFAULT 0,
                gym_sessions INTEGER DEFAULT 0,
                avg_screen_time REAL DEFAULT 0,
                avg_mood REAL,
                days_tracked INTEGER DEFAULT 0,
                consistency_score REAL DEFAULT 0,
                learning_target REAL DEFAULT 20,
                gym_target INTEGER DEFAULT 5,
                -- Day state counts (new)
                completed_days INTEGER DEFAULT 0,
                partial_days INTEGER DEFAULT 0,
                missed_days INTEGER DEFAULT 0,
                skipped_days INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Streaks table
            CREATE TABLE IF NOT EXISTS streaks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                streak_type TEXT UNIQUE NOT NULL,
                current_count INTEGER DEFAULT 0,
                best_count INTEGER DEFAULT 0,
                last_activity_date TEXT,
                broken_at TEXT,
                recovery_days INTEGER DEFAULT 0,
                penalty_applied INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Projects table
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                hours INTEGER DEFAULT 0,
                status TEXT DEFAULT 'in-progress',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Dynamic tasks table
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                text TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Life score history for analytics
            CREATE TABLE IF NOT EXISTS life_score_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                score REAL NOT NULL,
                learning_component REAL,
                workout_component REAL,
                sleep_component REAL,
                screen_component REAL,
                mit_component REAL,
                streak_bonus REAL,
                penalty REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- App settings/metadata
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Settings Authority table (new)
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                settings_json TEXT NOT NULL,
                effective_from TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Settings change history (new)
            CREATE TABLE IF NOT EXISTS settings_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                reason TEXT,
                changed_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Day state transitions log (new)
            CREATE TABLE IF NOT EXISTS day_state_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                from_state TEXT,
                to_state TEXT NOT NULL,
                reason TEXT,
                automatic INTEGER DEFAULT 0,
                logged_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Create indexes for better query performance
            CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
            CREATE INDEX IF NOT EXISTS idx_weekly_stats_week_start ON weekly_stats(week_start);
            CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
            CREATE INDEX IF NOT EXISTS idx_life_score_history_date ON life_score_history(date);
        `;

        db.exec(schema, (err) => {
            if (err) {
                console.error('Failed to create tables:', err);
                reject(err);
            } else {
                console.log('Database tables created/verified');
                resolve();
            }
        });
    });
}

/**
 * Run database migrations to add missing columns
 */
function runMigrations() {
    return new Promise((resolve, reject) => {
        console.log('Running database migrations...');
        
        // List of columns to add if missing
        const migrations = [
            // daily_logs table columns
            { table: 'daily_logs', column: 'day_state', type: "TEXT DEFAULT 'open'" },
            { table: 'daily_logs', column: 'locked', type: 'INTEGER DEFAULT 0' },
            { table: 'daily_logs', column: 'locked_at', type: 'TEXT' },
            { table: 'daily_logs', column: 'final_score', type: 'REAL' },
            { table: 'daily_logs', column: 'skipped', type: 'INTEGER DEFAULT 0' },
            { table: 'daily_logs', column: 'skip_reason', type: 'TEXT' },
            { table: 'daily_logs', column: 'completion_percent', type: 'REAL DEFAULT 0' },
            // weekly_stats table columns
            { table: 'weekly_stats', column: 'completed_days', type: 'INTEGER DEFAULT 0' },
            { table: 'weekly_stats', column: 'partial_days', type: 'INTEGER DEFAULT 0' },
            { table: 'weekly_stats', column: 'missed_days', type: 'INTEGER DEFAULT 0' },
            { table: 'weekly_stats', column: 'skipped_days', type: 'INTEGER DEFAULT 0' },
            // streaks table columns
            { table: 'streaks', column: 'recovery_days', type: 'INTEGER DEFAULT 0' },
            { table: 'streaks', column: 'penalty_applied', type: 'INTEGER DEFAULT 0' },
        ];
        
        let migrationCount = 0;
        let completed = 0;
        
        const checkAndAddColumn = (migration, callback) => {
            // Check if column exists using PRAGMA
            db.all(`PRAGMA table_info(${migration.table})`, (err, columns) => {
                if (err) {
                    console.error(`Error checking ${migration.table}:`, err);
                    callback();
                    return;
                }
                
                const columnExists = columns.some(col => col.name === migration.column);
                
                if (!columnExists) {
                    const alterSql = `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`;
                    db.run(alterSql, (alterErr) => {
                        if (alterErr) {
                            console.error(`Failed to add ${migration.column} to ${migration.table}:`, alterErr);
                        } else {
                            console.log(`Added column ${migration.column} to ${migration.table}`);
                            migrationCount++;
                        }
                        callback();
                    });
                } else {
                    callback();
                }
            });
        };
        
        // Process migrations sequentially
        const processMigration = (index) => {
            if (index >= migrations.length) {
                console.log(`Database migrations complete. ${migrationCount} columns added.`);
                resolve();
                return;
            }
            
            checkAndAddColumn(migrations[index], () => {
                processMigration(index + 1);
            });
        };
        
        processMigration(0);
    });
}

/**
 * Initialize default streak types and settings
 */
function initializeDefaults() {
    return new Promise((resolve, reject) => {
        const streakTypes = ['learning', 'workout', 'sleep', 'screen'];
        const today = getDateString(new Date());
        
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO streaks (streak_type, current_count, best_count, last_activity_date)
            VALUES (?, 0, 0, ?)
        `);
        
        streakTypes.forEach(type => {
            stmt.run(type, today);
        });
        
        stmt.finalize();

        // Set schema version
        db.run(`
            INSERT OR REPLACE INTO app_settings (key, value, updated_at)
            VALUES ('schema_version', ?, datetime('now'))
        `, [SCHEMA_VERSION.toString()], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Helper: Get date string in YYYY-MM-DD format
 */
function getDateString(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
}

/**
 * Helper: Get Monday of the week for a given date
 */
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday
    return getDateString(new Date(d.setDate(diff)));
}

/**
 * Helper: Get Sunday of the week for a given date
 */
function getWeekEnd(date) {
    const d = new Date(getWeekStart(date));
    d.setDate(d.getDate() + 6);
    return getDateString(d);
}

// ============================================
// DAILY LOG OPERATIONS
// ============================================

/**
 * Get today's log or create empty one
 */
function getTodayLog() {
    const today = getDateString(new Date());
    return getDayLog(today);
}

/**
 * Get log for a specific date
 */
function getDayLog(date) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM daily_logs WHERE date = ?', [date], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

/**
 * Save/Update today's log
 */
function saveDayLog(data) {
    const date = data.date || getDateString(new Date());
    
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT INTO daily_logs (
                date, wakeup_time, learning_done, learning_hours, learned_today,
                workout_done, workout_type, screen_time, mood,
                mit_1_text, mit_1_done, mit_2_text, mit_2_done, mit_3_text, mit_3_done,
                bedtime, life_score, productivity_score, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(date) DO UPDATE SET
                wakeup_time = excluded.wakeup_time,
                learning_done = excluded.learning_done,
                learning_hours = excluded.learning_hours,
                learned_today = excluded.learned_today,
                workout_done = excluded.workout_done,
                workout_type = excluded.workout_type,
                screen_time = excluded.screen_time,
                mood = excluded.mood,
                mit_1_text = excluded.mit_1_text,
                mit_1_done = excluded.mit_1_done,
                mit_2_text = excluded.mit_2_text,
                mit_2_done = excluded.mit_2_done,
                mit_3_text = excluded.mit_3_text,
                mit_3_done = excluded.mit_3_done,
                bedtime = excluded.bedtime,
                life_score = excluded.life_score,
                productivity_score = excluded.productivity_score,
                updated_at = datetime('now')
        `;
        
        db.run(sql, [
            date,
            data.wakeupTime || null,
            data.learningDone ? 1 : 0,
            data.learningHours || 0,
            data.learnedToday || null,
            data.workoutDone ? 1 : 0,
            data.workoutType || 'gym',
            data.screenTime || 0,
            data.mood || null,
            data.mit1Text || null,
            data.mit1Done ? 1 : 0,
            data.mit2Text || null,
            data.mit2Done ? 1 : 0,
            data.mit3Text || null,
            data.mit3Done ? 1 : 0,
            data.bedtime || null,
            data.lifeScore || null,
            data.productivityScore || null
        ], function(err) {
            if (err) {
                reject(err);
            } else {
                // Update weekly stats whenever daily log changes
                updateWeeklyStats(date)
                    .then(() => resolve({ id: this.lastID, date }))
                    .catch(reject);
            }
        });
    });
}

/**
 * Get history for last N days
 */
function getHistory(days = 30) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT * FROM daily_logs
            WHERE date >= date('now', '-' || ? || ' days')
            ORDER BY date DESC
        `;
        
        db.all(sql, [days], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Get history between dates
 */
function getHistoryRange(startDate, endDate) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM daily_logs WHERE date BETWEEN ? AND ? ORDER BY date DESC',
            [startDate, endDate],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// ============================================
// WEEKLY STATS OPERATIONS
// ============================================

/**
 * Get current week's stats
 */
function getCurrentWeekStats() {
    const weekStart = getWeekStart(new Date());
    return getWeekStats(weekStart);
}

/**
 * Get stats for a specific week
 */
function getWeekStats(weekStart) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM weekly_stats WHERE week_start = ?', [weekStart], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

/**
 * Recalculate and update weekly stats from daily logs
 */
function updateWeeklyStats(date) {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(date);
    
    return new Promise((resolve, reject) => {
        // Calculate aggregates from daily logs
        const sql = `
            SELECT 
                COUNT(*) as days_tracked,
                COALESCE(SUM(learning_hours), 0) as total_learning_hours,
                COALESCE(SUM(CASE WHEN workout_done = 1 THEN 1 ELSE 0 END), 0) as gym_sessions,
                COALESCE(AVG(screen_time), 0) as avg_screen_time,
                AVG(mood) as avg_mood
            FROM daily_logs
            WHERE date BETWEEN ? AND ?
        `;
        
        db.get(sql, [weekStart, weekEnd], (err, stats) => {
            if (err) {
                reject(err);
                return;
            }
            
            // Calculate consistency score
            const learningProgress = Math.min((stats.total_learning_hours / 20) * 100, 100);
            const gymProgress = Math.min((stats.gym_sessions / 5) * 100, 100);
            const consistencyScore = (learningProgress + gymProgress) / 2;
            
            // Upsert weekly stats
            const upsertSql = `
                INSERT INTO weekly_stats (
                    week_start, week_end, total_learning_hours, gym_sessions,
                    avg_screen_time, avg_mood, days_tracked, consistency_score, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(week_start) DO UPDATE SET
                    total_learning_hours = excluded.total_learning_hours,
                    gym_sessions = excluded.gym_sessions,
                    avg_screen_time = excluded.avg_screen_time,
                    avg_mood = excluded.avg_mood,
                    days_tracked = excluded.days_tracked,
                    consistency_score = excluded.consistency_score,
                    updated_at = datetime('now')
            `;
            
            db.run(upsertSql, [
                weekStart,
                weekEnd,
                stats.total_learning_hours,
                stats.gym_sessions,
                stats.avg_screen_time,
                stats.avg_mood,
                stats.days_tracked,
                consistencyScore
            ], (err) => {
                if (err) reject(err);
                else resolve({ weekStart, ...stats, consistencyScore });
            });
        });
    });
}

/**
 * Get weekly stats for analytics (multiple weeks)
 */
function getWeeklyHistory(weeks = 12) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT * FROM weekly_stats
            WHERE week_start >= date('now', '-' || ? || ' days')
            ORDER BY week_start DESC
        `;
        
        db.all(sql, [weeks * 7], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// ============================================
// STREAK OPERATIONS
// ============================================

/**
 * Get all streaks
 */
function getAllStreaks() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM streaks', [], (err, rows) => {
            if (err) reject(err);
            else {
                // Convert to object keyed by streak_type
                const streaks = {};
                (rows || []).forEach(row => {
                    streaks[row.streak_type] = row;
                });
                resolve(streaks);
            }
        });
    });
}

/**
 * Update a specific streak
 */
function updateStreak(type, data) {
    return new Promise((resolve, reject) => {
        const today = getDateString(new Date());
        
        db.get('SELECT * FROM streaks WHERE streak_type = ?', [type], (err, current) => {
            if (err) {
                reject(err);
                return;
            }
            
            let newCount = data.current_count !== undefined ? data.current_count : (current?.current_count || 0);
            let bestCount = Math.max(newCount, current?.best_count || 0);
            
            const sql = `
                UPDATE streaks SET
                    current_count = ?,
                    best_count = ?,
                    last_activity_date = ?,
                    broken_at = ?,
                    recovery_days = ?,
                    penalty_applied = ?,
                    updated_at = datetime('now')
                WHERE streak_type = ?
            `;
            
            db.run(sql, [
                newCount,
                bestCount,
                data.last_activity_date || today,
                data.broken_at || null,
                data.recovery_days || 0,
                data.penalty_applied ? 1 : 0,
                type
            ], function(err) {
                if (err) reject(err);
                else resolve({ type, current_count: newCount, best_count: bestCount });
            });
        });
    });
}

/**
 * Increment streak if activity was done today
 */
function incrementStreak(type) {
    return new Promise((resolve, reject) => {
        const today = getDateString(new Date());
        
        db.get('SELECT * FROM streaks WHERE streak_type = ?', [type], (err, current) => {
            if (err) {
                reject(err);
                return;
            }
            
            if (!current) {
                reject(new Error(`Streak type ${type} not found`));
                return;
            }
            
            // Check if already incremented today
            if (current.last_activity_date === today) {
                resolve(current);
                return;
            }
            
            // Check if yesterday was the last activity (continuing streak)
            const yesterday = getDateString(new Date(Date.now() - 86400000));
            let newCount;
            
            if (current.last_activity_date === yesterday || current.current_count === 0) {
                // Continue or start streak
                newCount = current.current_count + 1;
            } else {
                // Streak was broken, start from 1
                newCount = 1;
            }
            
            updateStreak(type, {
                current_count: newCount,
                last_activity_date: today,
                broken_at: null,
                recovery_days: 0,
                penalty_applied: false
            }).then(resolve).catch(reject);
        });
    });
}

/**
 * Break a streak
 */
function breakStreak(type) {
    const today = getDateString(new Date());
    return updateStreak(type, {
        current_count: 0,
        broken_at: today,
        recovery_days: 3,
        penalty_applied: true
    });
}

/**
 * Check and handle day transition for streaks
 */
function checkStreakDayTransition() {
    return new Promise((resolve, reject) => {
        const today = getDateString(new Date());
        const yesterday = getDateString(new Date(Date.now() - 86400000));
        
        db.all('SELECT * FROM streaks', [], async (err, streaks) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const streak of streaks) {
                    // If last activity wasn't yesterday and streak exists, it might be broken
                    if (streak.last_activity_date !== yesterday && 
                        streak.last_activity_date !== today && 
                        streak.current_count > 0) {
                        
                        // Check if there was activity yesterday
                        const yesterdayLog = await getDayLog(yesterday);
                        let hadActivity = false;
                        
                        switch (streak.streak_type) {
                            case 'learning':
                                hadActivity = yesterdayLog?.learning_done === 1;
                                break;
                            case 'workout':
                                hadActivity = yesterdayLog?.workout_done === 1;
                                break;
                            case 'sleep':
                                hadActivity = yesterdayLog?.wakeup_time && 
                                    yesterdayLog.wakeup_time <= '06:00';
                                break;
                            case 'screen':
                                hadActivity = yesterdayLog?.screen_time !== null && 
                                    yesterdayLog.screen_time < 3;
                                break;
                        }
                        
                        if (!hadActivity && !streak.broken_at) {
                            await breakStreak(streak.streak_type);
                        }
                    }
                }
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ============================================
// PROJECT OPERATIONS
// ============================================

/**
 * Get all projects
 */
function getAllProjects() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM projects ORDER BY created_at DESC', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Add a project
 */
function addProject(name, hours, status = 'completed') {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO projects (name, hours, status) VALUES (?, ?, ?)',
            [name, hours, status],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, name, hours, status });
            }
        );
    });
}

/**
 * Delete a project
 */
function deleteProject(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM projects WHERE id = ?', [id], function(err) {
            if (err) reject(err);
            else resolve({ deleted: this.changes > 0 });
        });
    });
}

/**
 * Get project count and total hours
 */
function getProjectStats() {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(hours), 0) as total_hours
            FROM projects
            WHERE status = 'completed'
        `, [], (err, row) => {
            if (err) reject(err);
            else resolve(row || { count: 0, total_hours: 0 });
        });
    });
}

// ============================================
// TASKS OPERATIONS
// ============================================

/**
 * Get tasks for a specific date
 */
function getTasksForDate(date) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM tasks WHERE date = ? ORDER BY sort_order, id',
            [date],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Get today's tasks
 */
function getTodayTasks() {
    return getTasksForDate(getDateString(new Date()));
}

/**
 * Add a task
 */
function addTask(text, date = null) {
    const taskDate = date || getDateString(new Date());
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO tasks (date, text, completed) VALUES (?, ?, 0)',
            [taskDate, text],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, date: taskDate, text, completed: 0 });
            }
        );
    });
}

/**
 * Update a task
 */
function updateTask(id, data) {
    return new Promise((resolve, reject) => {
        const updates = [];
        const values = [];
        
        if (data.text !== undefined) {
            updates.push('text = ?');
            values.push(data.text);
        }
        if (data.completed !== undefined) {
            updates.push('completed = ?');
            values.push(data.completed ? 1 : 0);
        }
        
        if (updates.length === 0) {
            resolve({ id });
            return;
        }
        
        values.push(id);
        
        db.run(
            `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
            values,
            function(err) {
                if (err) reject(err);
                else resolve({ id, ...data });
            }
        );
    });
}

/**
 * Delete a task
 */
function deleteTask(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM tasks WHERE id = ?', [id], function(err) {
            if (err) reject(err);
            else resolve({ deleted: this.changes > 0 });
        });
    });
}

// ============================================
// LIFE SCORE OPERATIONS
// ============================================

/**
 * Calculate and save life score for a date
 */
function calculateAndSaveLifeScore(date = null) {
    const targetDate = date || getDateString(new Date());
    
    return new Promise(async (resolve, reject) => {
        try {
            // Get daily log
            const dayLog = await getDayLog(targetDate);
            if (!dayLog) {
                resolve({ score: 0, breakdown: null });
                return;
            }
            
            // Get streaks
            const streaks = await getAllStreaks();
            
            // Get weekly stats for context
            const weekStats = await getCurrentWeekStats();
            
            // Calculate components
            let learningComponent = 0;
            let workoutComponent = 0;
            let sleepComponent = 0;
            let screenComponent = 0;
            let mitComponent = 0;
            let streakBonus = 0;
            let penalty = 0;
            
            // Learning (max 30 points)
            if (dayLog.learning_done) {
                learningComponent = Math.min(dayLog.learning_hours * 10, 30);
            }
            
            // Workout (max 20 points)
            if (dayLog.workout_done) {
                workoutComponent = 20;
            }
            
            // Sleep (max 20 points)
            if (dayLog.wakeup_time) {
                const wakeMinutes = timeToMinutes(dayLog.wakeup_time);
                const targetMinutes = timeToMinutes('05:45');
                if (wakeMinutes <= targetMinutes) {
                    sleepComponent = 20;
                } else if (wakeMinutes <= targetMinutes + 30) {
                    sleepComponent = 15;
                } else if (wakeMinutes <= targetMinutes + 60) {
                    sleepComponent = 10;
                } else {
                    sleepComponent = 5;
                }
            }
            
            // Screen time (max 15 points)
            if (dayLog.screen_time !== null) {
                if (dayLog.screen_time < 2) {
                    screenComponent = 15;
                } else if (dayLog.screen_time < 3) {
                    screenComponent = 12;
                } else if (dayLog.screen_time < 4) {
                    screenComponent = 8;
                } else if (dayLog.screen_time < 5) {
                    screenComponent = 4;
                } else {
                    screenComponent = 0;
                    penalty += 5; // Penalty for excessive screen time
                }
            }
            
            // MITs (max 15 points)
            const mitsCompleted = (dayLog.mit_1_done || 0) + 
                                  (dayLog.mit_2_done || 0) + 
                                  (dayLog.mit_3_done || 0);
            mitComponent = mitsCompleted * 5;
            
            // Streak bonuses (max 10 points)
            Object.values(streaks).forEach(streak => {
                if (streak.current_count >= 7) {
                    streakBonus += 2.5;
                } else if (streak.current_count >= 3) {
                    streakBonus += 1;
                }
            });
            streakBonus = Math.min(streakBonus, 10);
            
            // Penalties for broken streaks
            Object.values(streaks).forEach(streak => {
                if (streak.broken_at && streak.recovery_days > 0) {
                    penalty += 3;
                }
            });
            
            // Calculate final score
            const rawScore = learningComponent + workoutComponent + sleepComponent + 
                            screenComponent + mitComponent + streakBonus - penalty;
            const score = Math.max(0, Math.min(100, rawScore));
            
            // Save to history
            const sql = `
                INSERT INTO life_score_history (
                    date, score, learning_component, workout_component,
                    sleep_component, screen_component, mit_component,
                    streak_bonus, penalty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET
                    score = excluded.score,
                    learning_component = excluded.learning_component,
                    workout_component = excluded.workout_component,
                    sleep_component = excluded.sleep_component,
                    screen_component = excluded.screen_component,
                    mit_component = excluded.mit_component,
                    streak_bonus = excluded.streak_bonus,
                    penalty = excluded.penalty
            `;
            
            db.run(sql, [
                targetDate, score, learningComponent, workoutComponent,
                sleepComponent, screenComponent, mitComponent,
                streakBonus, penalty
            ], (err) => {
                if (err) {
                    reject(err);
                } else {
                    // Also update the daily log
                    db.run(
                        'UPDATE daily_logs SET life_score = ? WHERE date = ?',
                        [score, targetDate]
                    );
                    
                    resolve({
                        score,
                        breakdown: {
                            learning: learningComponent,
                            workout: workoutComponent,
                            sleep: sleepComponent,
                            screen: screenComponent,
                            mit: mitComponent,
                            streakBonus,
                            penalty
                        }
                    });
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Get life score history
 */
function getLifeScoreHistory(days = 30) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT * FROM life_score_history
            WHERE date >= date('now', '-' || ? || ' days')
            ORDER BY date DESC
        `, [days], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Helper to convert time string to minutes
 */
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// ============================================
// ANALYTICS OPERATIONS
// ============================================

/**
 * Get analytics data for charts
 */
function getAnalyticsData(days = 30) {
    return new Promise(async (resolve, reject) => {
        try {
            const history = await getHistory(days);
            const weeklyHistory = await getWeeklyHistory(Math.ceil(days / 7));
            const lifeScoreHistory = await getLifeScoreHistory(days);
            
            resolve({
                daily: history,
                weekly: weeklyHistory,
                lifeScores: lifeScoreHistory
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Get skill hours total
 */
function getTotalSkillHours() {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT COALESCE(SUM(learning_hours), 0) as total
            FROM daily_logs
        `, [], (err, row) => {
            if (err) reject(err);
            else resolve(row?.total || 0);
        });
    });
}

// ============================================
// SETTINGS OPERATIONS
// ============================================

/**
 * Get a setting
 */
function getSetting(key) {
    return new Promise((resolve, reject) => {
        db.get('SELECT value FROM app_settings WHERE key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || null);
        });
    });
}

/**
 * Set a setting
 */
function setSetting(key, value) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = datetime('now')
        `, [key, value], (err) => {
            if (err) reject(err);
            else resolve({ key, value });
        });
    });
}

// ============================================
// MIGRATION FROM LOCALSTORAGE
// ============================================

/**
 * Migrate data from localStorage format
 */
function migrateFromLocalStorage(localStorageData) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = typeof localStorageData === 'string' 
                ? JSON.parse(localStorageData) 
                : localStorageData;
            
            // Migrate daily history
            if (data.history && Array.isArray(data.history)) {
                for (const day of data.history) {
                    await saveDayLog({
                        date: day.date,
                        wakeupTime: day.wakeupTime,
                        learningDone: day.learningDone,
                        learningHours: day.learningHours,
                        learnedToday: day.learnedToday,
                        workoutDone: day.workoutDone,
                        workoutType: day.workoutType,
                        screenTime: day.screenTime,
                        mood: day.mood,
                        mit1Text: day.mits?.[0]?.text,
                        mit1Done: day.mits?.[0]?.done,
                        mit2Text: day.mits?.[1]?.text,
                        mit2Done: day.mits?.[1]?.done,
                        mit3Text: day.mits?.[2]?.text,
                        mit3Done: day.mits?.[2]?.done,
                        bedtime: day.bedtime,
                        lifeScore: day.lifeScore
                    });
                }
            }
            
            // Migrate today's data
            if (data.today) {
                await saveDayLog({
                    date: getDateString(new Date()),
                    wakeupTime: data.today.wakeupTime,
                    learningDone: data.today.learningDone,
                    learningHours: data.today.learningHours,
                    learnedToday: data.today.learnedToday,
                    workoutDone: data.today.workoutDone,
                    workoutType: data.today.workoutType,
                    screenTime: data.today.screenTime,
                    mood: data.today.mood,
                    mit1Text: data.today.mits?.[0]?.text,
                    mit1Done: data.today.mits?.[0]?.done,
                    mit2Text: data.today.mits?.[1]?.text,
                    mit2Done: data.today.mits?.[1]?.done,
                    mit3Text: data.today.mits?.[2]?.text,
                    mit3Done: data.today.mits?.[2]?.done,
                    bedtime: data.today.bedtime
                });
            }
            
            // Migrate streaks
            if (data.streaks) {
                for (const [type, streak] of Object.entries(data.streaks)) {
                    if (['learning', 'workout', 'sleep', 'screen'].includes(type)) {
                        await updateStreak(type, {
                            current_count: streak.current || 0,
                            last_activity_date: streak.lastDate || getDateString(new Date()),
                            broken_at: streak.brokenAt || null,
                            recovery_days: streak.recoveryDays || 0,
                            penalty_applied: streak.penaltyApplied || false
                        });
                    }
                }
            }
            
            // Migrate projects
            if (data.projects && Array.isArray(data.projects)) {
                for (const project of data.projects) {
                    await addProject(project.name, project.hours, project.status);
                }
            }
            
            // Mark migration complete
            await setSetting('migrated_from_localstorage', new Date().toISOString());
            
            resolve({ success: true, message: 'Migration completed successfully' });
        } catch (err) {
            reject(err);
        }
    });
}

// ============================================
// DATABASE CLOSE
// ============================================

/**
 * Close the database connection
 */
function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) reject(err);
                else {
                    console.log('Database connection closed');
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

// ============================================
// SETTINGS AUTHORITY DATABASE OPERATIONS
// ============================================

/**
 * Get current system settings
 */
function getSystemSettings() {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM system_settings ORDER BY effective_from DESC LIMIT 1',
            (err, row) => {
                if (err) reject(err);
                else if (row) {
                    try {
                        resolve({
                            settings: JSON.parse(row.settings_json),
                            effectiveFrom: row.effective_from,
                            id: row.id
                        });
                    } catch (e) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            }
        );
    });
}

/**
 * Save system settings
 */
function saveSystemSettings(settings) {
    return new Promise((resolve, reject) => {
        const settingsJson = JSON.stringify(settings);
        const effectiveFrom = new Date().toISOString();
        
        db.run(
            'INSERT INTO system_settings (settings_json, effective_from) VALUES (?, ?)',
            [settingsJson, effectiveFrom],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, effectiveFrom });
            }
        );
    });
}

/**
 * Log a settings change
 */
function logSettingsChange(path, oldValue, newValue, reason) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO settings_history (path, old_value, new_value, reason, changed_at)
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [path, JSON.stringify(oldValue), JSON.stringify(newValue), reason],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            }
        );
    });
}

/**
 * Get settings change history
 */
function getSettingsHistory(limit = 50) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM settings_history ORDER BY changed_at DESC LIMIT ?',
            [limit],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Lock a day (finalize its state)
 */
function lockDay(date, state, finalScore) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE daily_logs SET 
                locked = 1,
                locked_at = datetime('now'),
                day_state = ?,
                final_score = ?,
                updated_at = datetime('now')
             WHERE date = ?`,
            [state, finalScore, date],
            function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            }
        );
    });
}

/**
 * Create a missed day entry
 */
function createMissedDay(date) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO daily_logs 
                (date, day_state, locked, locked_at, final_score, learning_done, workout_done)
             VALUES (?, 'missed', 1, datetime('now'), 0, 0, 0)`,
            [date],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            }
        );
    });
}

/**
 * Skip a day
 */
function skipDay(date, reason) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE daily_logs SET 
                skipped = 1,
                skip_reason = ?,
                day_state = 'skipped',
                updated_at = datetime('now')
             WHERE date = ?`,
            [reason, date],
            function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            }
        );
    });
}

/**
 * Log day state transition
 */
function logDayStateTransition(date, fromState, toState, reason, automatic = false) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO day_state_log (date, from_state, to_state, reason, automatic)
             VALUES (?, ?, ?, ?, ?)`,
            [date, fromState, toState, reason, automatic ? 1 : 0],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            }
        );
    });
}

/**
 * Get day state transitions for a date
 */
function getDayStateLog(date) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM day_state_log WHERE date = ? ORDER BY logged_at',
            [date],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Get days by state for a period
 */
function getDaysByState(startDate, endDate) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT date, day_state, final_score, locked, skipped 
             FROM daily_logs 
             WHERE date BETWEEN ? AND ?
             ORDER BY date`,
            [startDate, endDate],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Get unlocked days that need to be closed
 */
function getUnlockedDays(beforeDate) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM daily_logs 
             WHERE locked = 0 AND date < ?
             ORDER BY date`,
            [beforeDate],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Clear all data (development reset)
 */
function clearAllData() {
    return new Promise((resolve, reject) => {
        const tables = ['daily_logs', 'weekly_stats', 'tasks', 'life_score_history', 
                      'system_settings', 'settings_history', 'day_state_log'];
        
        let completed = 0;
        let errors = [];
        
        tables.forEach(table => {
            db.run(`DELETE FROM ${table}`, (err) => {
                if (err) {
                    console.warn(`Failed to clear ${table}:`, err);
                    errors.push({ table, error: err.message });
                }
                completed++;
                if (completed === tables.length) {
                    // Reset streaks
                    db.run(`UPDATE streaks SET current_count = 0, best_count = 0, recovery_days = 0, last_broken = NULL`, (err) => {
                        if (err) {
                            errors.push({ table: 'streaks', error: err.message });
                        }
                        console.log('Database cleared. Errors:', errors.length);
                        resolve({ success: true, errors });
                    });
                }
            });
        });
    });
}

// Export all functions
module.exports = {
    initDatabase,
    closeDatabase,
    clearAllData,
    getDateString,
    getWeekStart,
    getWeekEnd,
    
    // Daily logs
    getTodayLog,
    getDayLog,
    saveDayLog,
    getHistory,
    getHistoryRange,
    
    // Weekly stats
    getCurrentWeekStats,
    getWeekStats,
    updateWeeklyStats,
    getWeeklyHistory,
    
    // Streaks
    getAllStreaks,
    updateStreak,
    incrementStreak,
    breakStreak,
    checkStreakDayTransition,
    
    // Projects
    getAllProjects,
    addProject,
    deleteProject,
    getProjectStats,
    
    // Tasks
    getTasksForDate,
    getTodayTasks,
    addTask,
    updateTask,
    deleteTask,
    
    // Life score
    calculateAndSaveLifeScore,
    getLifeScoreHistory,
    
    // Analytics
    getAnalyticsData,
    getTotalSkillHours,
    
    // Settings
    getSetting,
    setSetting,
    
    // Settings Authority
    getSystemSettings,
    saveSystemSettings,
    logSettingsChange,
    getSettingsHistory,
    
    // Day State Management
    lockDay,
    createMissedDay,
    skipDay,
    logDayStateTransition,
    getDayStateLog,
    getDaysByState,
    getUnlockedDays,
    
    // Migration
    migrateFromLocalStorage
};
