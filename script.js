// ============================================
// DATA VERSION & SCHEMA
// ============================================
const DATA_VERSION = 4;
const SCHEMA = {
    version: DATA_VERSION,
    year: {
        skillHours: 0,
        projects: 0,
        jobStatus: false,
        lifeScore: 0
    },
    dailyLogs: [],
    streaks: {
        learning: 0,
        gym: 0,
        sleep: 0
    },
    streakHistory: {
        learning: { best: 0, lastBroken: null, recoveryDays: 0, lastUpdated: null },
        gym: { best: 0, lastBroken: null, recoveryDays: 0, lastUpdated: null },
        sleep: { best: 0, lastBroken: null, recoveryDays: 0, lastUpdated: null }
    },
    weeklyTargets: {
        learningHours: 20,
        gymSessions: 5
    },
    weekStart: null,
    lastActiveDate: null,
    settings: {
        theme: 'dark',
        wakeupTarget: '05:45',
        bedtimeTarget: '23:30',
        screenTimeGoal: 3
    }
};

// ============================================
// DAY STATES (FINAL + STRICT) - v11 Logic-First System
// ============================================
// Only THREE states exist - psychologically fair:
// COMPLETED = Save happened + All required habits valid → Streak continues
// MISSED = Save happened + One or more required habits invalid → Streak breaks
// NOT_COUNTED = No save + No interaction → Streak PAUSED (neutral)
// 
// CRITICAL RULE: Only deliberate actions change outcomes.
// Silence should never feel like punishment.
// ============================================
const DAY_STATES = {
    NOT_COUNTED: 'NOT_COUNTED',  // No save - Neutral, streak PAUSED
    COMPLETED: 'COMPLETED',       // Save + all habits valid - Streak+
    MISSED: 'MISSED',             // Save + habits invalid - Streak BREAKS
    // UI-only states (not final states):
    NOT_STARTED: 'NOT_STARTED',   // No data yet today
    IN_PROGRESS: 'IN_PROGRESS'    // Some data, not finalized
};

// Day State Info for UI feedback
const DAY_STATE_INFO = {
    COMPLETED: { 
        icon: '✓', 
        label: 'Completed', 
        description: 'All required habits validated - Streak continues', 
        color: 'success',
        cssClass: 'state-completed'
    },
    MISSED: { 
        icon: '✗', 
        label: 'Missed', 
        description: 'Requirements not met - Streak broken', 
        color: 'danger',
        cssClass: 'state-missed'
    },
    NOT_COUNTED: { 
        icon: '⏸', 
        label: 'Not Counted', 
        description: 'Day not finalized - Streak paused (neutral)', 
        color: 'neutral',
        cssClass: 'state-not-counted'
    },
    NOT_STARTED: {
        icon: '○',
        label: 'Not Started',
        description: 'Start logging your activities',
        color: 'muted',
        cssClass: 'state-not-started'
    },
    IN_PROGRESS: {
        icon: '◐',
        label: 'In Progress',
        description: 'Keep going! Complete your habits.',
        color: 'info',
        cssClass: 'state-in-progress'
    }
};

// Dashboard State Management
let dashboardData = JSON.parse(JSON.stringify(SCHEMA));

// Safe references to external systems (loaded from other files)
// These will be null if the corresponding module isn't loaded
const getHabitSystem = () => typeof window !== 'undefined' && window.HabitSystem ? window.HabitSystem : null;
const getDayState = () => typeof window !== 'undefined' && window.DayState ? window.DayState : null;

// ============================================
// SQL BACKEND INTEGRATION
// ============================================
let useBackend = false; // Will be set based on backend availability
let backendData = null; // Cached data from backend
let pendingSave = null; // Debounce save operations
let weeklyStatsCache = null; // Cache for weekly stats from SQL

/**
 * Check if the backend API is available
 */
async function checkBackendAvailable() {
    if (typeof API === 'undefined') return false;
    try {
        return await API.isAvailable();
    } catch {
        return false;
    }
}

/**
 * Initialize connection to backend
 */
async function initBackend() {
    useBackend = await checkBackendAvailable();
    
    if (useBackend) {
        console.log('✓ Connected to SQL backend');
        
        // Check if migration is needed
        const migrationStatus = await API.getMigrationStatus();
        if (!migrationStatus.migrated && localStorage.getItem('dashboardData')) {
            await migrateToBackend();
        }
        
        // Load data from backend
        await loadFromBackend();
    } else {
        console.log('⚠ Backend not available, using localStorage');
    }
}

/**
 * Migrate localStorage data to SQL backend
 */
async function migrateToBackend() {
    console.log('Migrating data from localStorage to SQL backend...');
    
    try {
        const localData = localStorage.getItem('dashboardData');
        if (localData) {
            const parsed = JSON.parse(localData);
            
            // Format data for migration
            const migrationData = {
                history: parsed.dailyLogs?.map(log => ({
                    date: log.date,
                    wakeupTime: log.wakeUp,
                    learningDone: log.learningDone,
                    learningHours: log.learningHours,
                    learnedToday: log.learned,
                    workoutDone: log.workout,
                    workoutType: log.workoutType,
                    screenTime: log.screenTime,
                    mood: log.mood,
                    mits: log.mits?.map((text, i) => ({
                        text: text,
                        done: log.mitsDone?.[i] || false
                    })),
                    bedtime: null,
                    lifeScore: null
                })) || [],
                streaks: {
                    learning: {
                        current: parsed.streaks?.learning || 0,
                        lastDate: parsed.lastActiveDate,
                        brokenAt: parsed.streakHistory?.learning?.lastBroken,
                        recoveryDays: parsed.streakHistory?.learning?.recoveryDays || 0
                    },
                    workout: {
                        current: parsed.streaks?.gym || 0,
                        lastDate: parsed.lastActiveDate,
                        brokenAt: parsed.streakHistory?.gym?.lastBroken,
                        recoveryDays: parsed.streakHistory?.gym?.recoveryDays || 0
                    },
                    sleep: {
                        current: parsed.streaks?.sleep || 0,
                        lastDate: parsed.lastActiveDate,
                        brokenAt: parsed.streakHistory?.sleep?.lastBroken,
                        recoveryDays: parsed.streakHistory?.sleep?.recoveryDays || 0
                    }
                },
                projects: [] // Projects would need separate tracking
            };
            
            await API.migrateFromLocalStorage(migrationData);
            console.log('✓ Migration complete');
        }
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

/**
 * Load all data from backend
 */
async function loadFromBackend() {
    try {
        const data = await API.getToday();
        backendData = data;
        
        // Map backend data to local format
        if (data.today && Object.keys(data.today).length > 0) {
            const log = data.today;
            const todayLog = {
                date: log.date || getDateString(),
                wakeUp: log.wakeup_time || dashboardData.settings.wakeupTarget,
                sleptOnTime: null,
                learned: log.learned_today || '',
                learningDone: !!log.learning_done,
                learningHours: log.learning_hours || 0,
                workout: !!log.workout_done,
                workoutType: log.workout_type || 'gym',
                screenTime: log.screen_time || 0,
                mood: log.mood || null,
                mits: [log.mit_1_text || '', log.mit_2_text || '', log.mit_3_text || ''],
                mitsDone: [!!log.mit_1_done, !!log.mit_2_done, !!log.mit_3_done],
                tasks: [],
                archived: false
            };
            
            // Update or add today's log
            const existingIdx = dashboardData.dailyLogs.findIndex(l => l.date === todayLog.date);
            if (existingIdx >= 0) {
                dashboardData.dailyLogs[existingIdx] = todayLog;
            } else {
                dashboardData.dailyLogs.push(todayLog);
            }
        }
        
        // Map streaks
        if (data.streaks) {
            dashboardData.streaks.learning = data.streaks.learning?.current_count || 0;
            dashboardData.streaks.gym = data.streaks.workout?.current_count || 0;
            dashboardData.streaks.sleep = data.streaks.sleep?.current_count || 0;
            
            dashboardData.streakHistory.learning.best = data.streaks.learning?.best_count || 0;
            dashboardData.streakHistory.gym.best = data.streaks.workout?.best_count || 0;
            dashboardData.streakHistory.sleep.best = data.streaks.sleep?.best_count || 0;
            
            dashboardData.streakHistory.learning.recoveryDays = data.streaks.learning?.recovery_days || 0;
            dashboardData.streakHistory.gym.recoveryDays = data.streaks.workout?.recovery_days || 0;
            dashboardData.streakHistory.sleep.recoveryDays = data.streaks.sleep?.recovery_days || 0;
        }
        
        // Map week stats
        if (data.weekStats) {
            weeklyStatsCache = data.weekStats;
        }
        
        // Map life score
        if (data.lifeScore) {
            dashboardData.year.lifeScore = data.lifeScore.score || 0;
        }
        
        // Map total skill hours
        if (data.totalSkillHours !== undefined) {
            dashboardData.year.skillHours = data.totalSkillHours;
        }
        
        // Map project stats
        if (data.projectStats) {
            dashboardData.year.projects = data.projectStats.count || 0;
        }
        
        // Load tasks
        if (data.tasks) {
            const todayLog = getTodayLog();
            todayLog.tasks = data.tasks.map(t => ({
                id: t.id,
                text: t.text,
                done: !!t.completed
            }));
        }
        
        // Load history for charts
        await loadHistoryFromBackend();
        
    } catch (err) {
        console.error('Failed to load from backend:', err);
        useBackend = false;
    }
}

/**
 * Load history data from backend for charts and analytics
 */
async function loadHistoryFromBackend() {
    try {
        const historyData = await API.getHistory(90);
        
        if (historyData.history && historyData.history.length > 0) {
            // Map backend format to local format
            const mappedLogs = historyData.history.map(log => ({
                date: log.date,
                wakeUp: log.wakeup_time || dashboardData.settings.wakeupTarget,
                sleptOnTime: null,
                learned: log.learned_today || '',
                learningDone: !!log.learning_done,
                learningHours: log.learning_hours || 0,
                workout: !!log.workout_done,
                workoutType: log.workout_type || 'gym',
                screenTime: log.screen_time || 0,
                mood: log.mood || null,
                mits: [log.mit_1_text || '', log.mit_2_text || '', log.mit_3_text || ''],
                mitsDone: [!!log.mit_1_done, !!log.mit_2_done, !!log.mit_3_done],
                tasks: [],
                archived: true
            }));
            
            // Merge with local logs (backend is source of truth)
            const localToday = dashboardData.dailyLogs.find(l => l.date === getDateString());
            dashboardData.dailyLogs = mappedLogs;
            
            // Ensure today's log exists
            if (localToday && !dashboardData.dailyLogs.find(l => l.date === localToday.date)) {
                dashboardData.dailyLogs.push(localToday);
            }
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

/**
 * Save data to backend (with debounce)
 */
function saveToBackend() {
    if (!useBackend) return;
    
    // Debounce saves to prevent too many API calls
    if (pendingSave) {
        clearTimeout(pendingSave);
    }
    
    pendingSave = setTimeout(async () => {
        try {
            const todayLog = getTodayLog();
            
            // Ensure arrays exist
            const mits = todayLog.mits || ['', '', ''];
            const mitsDone = todayLog.mitsDone || [false, false, false];
            
            // Format for backend
            const payload = {
                date: todayLog.date,
                wakeupTime: todayLog.wakeUp,
                learningDone: todayLog.learningDone,
                learningHours: todayLog.learningHours,
                learnedToday: todayLog.learned,
                workoutDone: todayLog.workout,
                workoutType: todayLog.workoutType,
                screenTime: todayLog.screenTime,
                mood: todayLog.mood,
                mit1Text: mits[0] || '',
                mit1Done: mitsDone[0] || false,
                mit2Text: mits[1] || '',
                mit2Done: mitsDone[1] || false,
                mit3Text: mits[2] || '',
                mit3Done: mitsDone[2] || false,
                bedtime: null,
                lifeScore: dashboardData.year.lifeScore
            };
            
            const result = await API.saveToday(payload);
            
            // Update cached week stats from backend response
            if (result.weekStats) {
                weeklyStatsCache = result.weekStats;
                updateWeeklyStatsFromBackend();
            }
            
            // Update life score from backend calculation
            if (result.lifeScore) {
                dashboardData.year.lifeScore = result.lifeScore.score;
            }
            
        } catch (err) {
            console.error('Failed to save to backend:', err);
        }
    }, 500);
}

/**
 * Update weekly stats display from backend data
 */
function updateWeeklyStatsFromBackend() {
    if (!weeklyStatsCache) return;
    
    const stats = weeklyStatsCache;
    const learningTarget = dashboardData.weeklyTargets.learningHours;
    const gymTarget = dashboardData.weeklyTargets.gymSessions;
    
    // Learning hours
    const learningHours = stats.total_learning_hours || 0;
    const learningPercent = Math.min((learningHours / learningTarget) * 100, 100);
    
    document.getElementById('learning-hours').textContent = `${Math.round(learningHours * 10) / 10}h`;
    gsap.to('#learning-progress', {
        width: `${learningPercent}%`,
        duration: 0.8,
        ease: 'power2.out'
    });
    
    // Apply visual state based on progress
    const learningProgress = document.getElementById('learning-progress');
    if (learningProgress) {
        learningProgress.classList.remove('on-track', 'behind', 'critical');
        if (learningPercent >= 70) {
            learningProgress.classList.add('on-track');
        } else if (learningPercent >= 40) {
            learningProgress.classList.add('behind');
        } else {
            learningProgress.classList.add('critical');
        }
    }
    
    // Gym sessions
    const gymSessions = stats.gym_sessions || 0;
    const gymPercent = Math.min((gymSessions / gymTarget) * 100, 100);
    
    document.getElementById('gym-sessions').textContent = gymSessions;
    gsap.to('#gym-progress', {
        width: `${gymPercent}%`,
        duration: 0.8,
        ease: 'power2.out'
    });
    
    // Apply visual state
    const gymProgress = document.getElementById('gym-progress');
    if (gymProgress) {
        gymProgress.classList.remove('on-track', 'behind', 'critical');
        if (gymPercent >= 70) {
            gymProgress.classList.add('on-track');
        } else if (gymPercent >= 40) {
            gymProgress.classList.add('behind');
        } else {
            gymProgress.classList.add('critical');
        }
    }
    
    // Consistency score from backend
    if (stats.consistency_score !== undefined) {
        document.getElementById('weekly-consistency').textContent = `${Math.round(stats.consistency_score)}%`;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getDateString(date = new Date()) {
    return date.toISOString().split('T')[0];
}

function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getDaysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function getMonday(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize backend connection first
    await initBackend();
    
    // If no backend, load from localStorage
    if (!useBackend) {
        loadFromStorage();
    }
    
    // Initialize Settings Authority system
    await initSettingsAuthority();
    
    // Initialize Habit System
    initHabitSystem();
    
    initDashboard();
    initTheme();
    initDate();
    initEventListeners();
    initCharts();
    updateDashboard();
    updateDayStateDisplay();
    animateEntrance();
    startDayChangeWatcher();
    
    // Auto-close past days if backend available
    if (useBackend && dayLockAuthority) {
        try {
            await API.closeDays(getDateString());
        } catch (err) {
            console.warn('Failed to close past days:', err);
        }
    }
});

function initDashboard() {
    validateWeekStart();
}

function validateWeekStart() {
    const currentMonday = getMonday();
    const storedWeekStart = dashboardData.weekStart ? new Date(dashboardData.weekStart) : null;
    
    if (!storedWeekStart || storedWeekStart.getTime() !== currentMonday.getTime()) {
        // New week started - reset weekly stats
        if (storedWeekStart && storedWeekStart < currentMonday) {
            archiveWeekData();
        }
        dashboardData.weekStart = currentMonday.toISOString();
        saveToStorage();
    }
}

function archiveWeekData() {
    // Weekly data is already in dailyLogs, just reset week start
    console.log('Week archived, starting fresh week');
}

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('dashboardTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    dashboardData.settings.theme = savedTheme;
    
    // Update toggle button
    const themeBtn = document.getElementById('theme-switch');
    if (savedTheme === 'dark') {
        themeBtn.querySelector('.fa-moon').style.opacity = '0';
        themeBtn.querySelector('.fa-sun').style.opacity = '1';
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    // Set theme immediately for better UX
    document.documentElement.setAttribute('data-theme', newTheme);
    dashboardData.settings.theme = newTheme;
    localStorage.setItem('dashboardTheme', newTheme);
    
    // Update chart colors for new theme
    updateChartColors();
    
    // Animate toggle button
    const themeBtn = document.getElementById('theme-switch');
    gsap.to(themeBtn, {
        duration: 0.3,
        scale: 1.1,
        rotation: 180,
        onComplete: () => {
            gsap.to(themeBtn, { duration: 0.3, scale: 1, rotation: 0 });
        }
    });
}

// Update chart colors when theme changes
function updateChartColors() {
    const colors = getChartColors();
    
    if (skillHoursChart) {
        skillHoursChart.data.datasets[0].borderColor = colors.primary;
        skillHoursChart.data.datasets[0].backgroundColor = colors.primary + '1a';
        skillHoursChart.options.scales.x.grid.color = colors.borderColor;
        skillHoursChart.options.scales.y.grid.color = colors.borderColor;
        skillHoursChart.options.scales.x.ticks.color = colors.textSecondary;
        skillHoursChart.options.scales.y.ticks.color = colors.textSecondary;
        skillHoursChart.update();
    }
    
    if (disciplineChart) {
        disciplineChart.data.datasets[0].backgroundColor = colors.success;
        disciplineChart.data.datasets[0].borderColor = colors.success;
        disciplineChart.options.scales.x.grid.color = colors.borderColor;
        disciplineChart.options.scales.y.grid.color = colors.borderColor;
        disciplineChart.options.scales.x.ticks.color = colors.textSecondary;
        disciplineChart.options.scales.y.ticks.color = colors.textSecondary;
        disciplineChart.update();
    }
    
    if (moodProductivityChart) {
        moodProductivityChart.data.datasets[0].borderColor = colors.secondary;
        moodProductivityChart.data.datasets[0].backgroundColor = colors.secondary + '1a';
        moodProductivityChart.data.datasets[1].borderColor = colors.info;
        moodProductivityChart.data.datasets[1].backgroundColor = colors.info + '1a';
        moodProductivityChart.options.scales.x.grid.color = colors.borderColor;
        moodProductivityChart.options.scales.y.grid.color = colors.borderColor;
        moodProductivityChart.options.scales.x.ticks.color = colors.textSecondary;
        moodProductivityChart.options.scales.y.ticks.color = colors.textSecondary;
        moodProductivityChart.options.scales.y1.ticks.color = colors.textSecondary;
        moodProductivityChart.update();
    }
    
    if (screenTimeChart) {
        screenTimeChart.data.datasets[0].backgroundColor = colors.warning;
        screenTimeChart.data.datasets[0].borderColor = colors.warning;
        screenTimeChart.options.scales.x.grid.color = colors.borderColor;
        screenTimeChart.options.scales.y.grid.color = colors.borderColor;
        screenTimeChart.options.scales.x.ticks.color = colors.textSecondary;
        screenTimeChart.options.scales.y.ticks.color = colors.textSecondary;
        screenTimeChart.update();
    }
}

// Date Management
function initDate() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    document.getElementById('current-date').textContent = dateStr;
    document.getElementById('daily-date').textContent = dateStr;
    
    // Calculate days until week reset
    const daysUntilReset = 7 - (now.getDay() || 7);
    document.getElementById('week-reset-info').textContent = 
        `Auto-resets in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''}`;
}

// ============================================
// SETTINGS AUTHORITY INTEGRATION
// ============================================
let settingsAuthority = null;
let dayStateManager = null;
let toggleAuthority = null;
let dayLockAuthority = null;
let streakAuthority = null;
let lifeScoreAuthority = null;

/**
 * Initialize Habit System with current settings
 */
function initHabitSystem() {
    const habitSystem = getHabitSystem();
    if (!habitSystem) {
        console.warn('[HabitSystem] Not loaded');
        return;
    }
    
    // Get settings from Settings Authority or use defaults
    const settings = settingsAuthority?.getAllSettings?.() || 
                     settingsAuthority?.current ||
                     (typeof SettingsAuthority !== 'undefined' ? SettingsAuthority.defaults : null) ||
                     null;
    
    habitSystem.init(settings);
    console.log('[HabitSystem] Initialized with settings');
    
    // Apply initial habit states to UI
    applyHabitStates();
}

/**
 * Apply habit enable/disable states to UI
 */
function applyHabitStates() {
    const habitSystem = getHabitSystem();
    if (!habitSystem) return;
    
    const habits = ['learning', 'gym', 'sleep', 'screenTime'];
    
    habits.forEach(habitId => {
        const isEnabled = habitSystem.isHabitEnabled(habitId);
        const cardMap = {
            learning: '.learning-card',
            gym: '.workout-card',
            sleep: '.wakeup-card',
            screenTime: '.screen-time-slider'
        };
        
        const card = document.querySelector(cardMap[habitId]);
        if (card) {
            if (!isEnabled) {
                card.classList.add('habit-disabled');
                // Disable inputs for disabled habits
                const inputs = card.querySelectorAll('input, select');
                inputs.forEach(input => input.disabled = true);
            } else {
                card.classList.remove('habit-disabled');
            }
        }
    });
}

/**
 * Initialize Settings Authority system
 */
async function initSettingsAuthority() {
    if (typeof SettingsAuthority === 'undefined') {
        console.warn('Settings Authority not loaded');
        return false;
    }
    
    try {
        // Use the objects directly (they're singletons, not classes)
        settingsAuthority = SettingsAuthority;
        
        // Initialize settings (loads from backend or localStorage)
        await SettingsAuthority.init();
        
        // Reference other authorities (they're objects, not classes)
        dayStateManager = typeof DayStateManager !== 'undefined' ? DayStateManager : null;
        toggleAuthority = typeof ToggleAuthority !== 'undefined' ? ToggleAuthority : null;
        dayLockAuthority = typeof DayLockAuthority !== 'undefined' ? DayLockAuthority : null;
        streakAuthority = typeof StreakAuthority !== 'undefined' ? StreakAuthority : null;
        lifeScoreAuthority = typeof LifeScoreAuthority !== 'undefined' ? LifeScoreAuthority : null;
        
        console.log('✓ Settings Authority system initialized');
        return true;
    } catch (err) {
        console.error('Failed to initialize Settings Authority:', err);
        return false;
    }
}

/**
 * Open settings modal
 */
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) {
        console.error('Settings modal not found');
        return;
    }
    
    // Populate settings from authority
    const settings = settingsAuthority?.current || SettingsAuthority?.current || SettingsAuthority?.defaults;
    if (settings) {
        // Day cutoff
        const cutoffHour = parseInt(settings.dayCutoffTime?.split(':')[0] || 2);
        const cutoffInput = document.getElementById('day-cutoff-hour');
        if (cutoffInput) cutoffInput.value = cutoffHour;
        
        // Non-negotiables
        const nn = settings.nonNegotiables || {};
        const learningCheck = document.getElementById('non-neg-learning');
        const gymCheck = document.getElementById('non-neg-gym');
        const sleepCheck = document.getElementById('non-neg-sleep');
        const screenCheck = document.getElementById('non-neg-screen');
        
        if (learningCheck) learningCheck.checked = nn.learning?.enabled ?? true;
        if (gymCheck) gymCheck.checked = nn.gym?.enabled ?? true;
        if (sleepCheck) sleepCheck.checked = nn.sleep?.enabled ?? true;
        if (screenCheck) screenCheck.checked = nn.screenTime?.enabled ?? true;
        
        // Streak settings
        const sensitivitySelect = document.getElementById('streak-sensitivity');
        if (sensitivitySelect) sensitivitySelect.value = settings.streaks?.sensitivity || 'normal';
        
        const skipPreserves = document.getElementById('skip-preserves-streak');
        if (skipPreserves) skipPreserves.checked = settings.skipDays?.preservesStreak ?? true;
        
        // Skip limits
        const skipWeek = document.getElementById('skip-per-week');
        const skipMonth = document.getElementById('skip-per-month');
        if (skipWeek) skipWeek.value = settings.skipDays?.maxPerWeek ?? 1;
        if (skipMonth) skipMonth.value = settings.skipDays?.maxPerMonth ?? 3;
        
        // Scoring weights
        const weights = settings.scoring?.weights || { consistency: 40, streaks: 30, completion: 30 };
        const wConsistency = document.getElementById('weight-consistency');
        const wStreaks = document.getElementById('weight-streaks');
        const wCompletion = document.getElementById('weight-completion');
        if (wConsistency) wConsistency.value = weights.learning || 30;
        if (wStreaks) wStreaks.value = weights.gym || 25;
        if (wCompletion) wCompletion.value = weights.sleep || 25;
        updateWeightDisplays();
    }
    
    modal.classList.add('active');
    console.log('Settings modal opened');
}

/**
 * Close settings modal
 */
function closeSettingsModal() {
    document.getElementById('settings-modal')?.classList.remove('active');
}

/**
 * Save settings
 */
async function saveSettings() {
    try {
        const settings = settingsAuthority?.current || SettingsAuthority?.current;
        if (!settings) {
            console.warn('No settings to save');
            return;
        }
        
        // Get values from form
        const cutoffHour = document.getElementById('day-cutoff-hour')?.value || 2;
        
        // Update settings using set() method
        await SettingsAuthority.set('dayCutoffTime', `${cutoffHour}:00`, 'User update');
        
        // Non-negotiables
        await SettingsAuthority.set('nonNegotiables.learning.enabled', 
            document.getElementById('non-neg-learning')?.checked ?? true, 'User update');
        await SettingsAuthority.set('nonNegotiables.gym.enabled', 
            document.getElementById('non-neg-gym')?.checked ?? true, 'User update');
        await SettingsAuthority.set('nonNegotiables.sleep.enabled', 
            document.getElementById('non-neg-sleep')?.checked ?? true, 'User update');
        await SettingsAuthority.set('nonNegotiables.screenTime.enabled', 
            document.getElementById('non-neg-screen')?.checked ?? true, 'User update');
        
        // Streak settings
        const sensitivity = document.getElementById('streak-sensitivity')?.value || 'normal';
        await SettingsAuthority.set('streaks.sensitivity', sensitivity, 'User update');
        
        // Skip day limits
        const skipWeek = parseInt(document.getElementById('skip-per-week')?.value || 1);
        const skipMonth = parseInt(document.getElementById('skip-per-month')?.value || 3);
        await SettingsAuthority.set('skipDays.maxPerWeek', skipWeek, 'User update');
        await SettingsAuthority.set('skipDays.maxPerMonth', skipMonth, 'User update');
        
        closeSettingsModal();
        showNotification('Settings saved! Changes will apply to future days.', 'success');
        
        // Re-initialize habit system with new settings
        initHabitSystem();
        
        // IMMEDIATELY apply habit visibility to Daily Routine
        applyHabitVisibility();
        
        // Update day state display (only enabled habits affect it)
        updateDayStateDisplay();
        
    } catch (err) {
        console.error('Failed to save settings:', err);
        showNotification('Failed to save settings', 'error');
    }
}

/**
 * Update weight value displays
 */
function updateWeightDisplays() {
    ['consistency', 'streaks', 'completion'].forEach(type => {
        const slider = document.getElementById(`weight-${type}`);
        const display = slider?.nextElementSibling;
        if (display) {
            display.textContent = `${slider.value}%`;
        }
    });
}

/**
 * Generate test data for previous days
 */
async function generateTestData() {
    if (!confirm('This will generate 30 days of test history data. Continue?')) {
        return;
    }
    
    closeSettingsModal();
    showNotification('Generating test data...', 'info');
    
    const topics = [
        'TypeScript fundamentals', 'React hooks deep dive', 'Node.js streams',
        'GraphQL basics', 'Docker containerization', 'AWS Lambda functions',
        'Python data analysis', 'Machine learning intro', 'CSS Grid mastery',
        'Vue.js composition API', 'PostgreSQL optimization', 'Redis caching',
        'Kubernetes basics', 'CI/CD pipelines', 'Testing strategies'
    ];
    
    const workoutTypes = ['gym', 'run', 'home', 'swim', 'bike'];
    const moods = ['amazing', 'good', 'neutral', 'tired', 'stressed'];
    const dayStates = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'PARTIAL', 'PARTIAL', 'MISSED'];
    
    const testData = [];
    const today = new Date();
    
    for (let i = 30; i >= 1; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        // Randomize data with realistic patterns
        const dayState = dayStates[Math.floor(Math.random() * dayStates.length)];
        const learningDone = dayState !== 'MISSED' && Math.random() > 0.2;
        const workoutDone = dayState === 'COMPLETED' ? Math.random() > 0.3 : Math.random() > 0.6;
        const learningHours = learningDone ? Math.round((1 + Math.random() * 4) * 10) / 10 : 0;
        
        // Wake up time between 5:00 and 8:00
        const wakeHour = 5 + Math.floor(Math.random() * 3);
        const wakeMin = Math.floor(Math.random() * 60);
        const wakeupTime = `${String(wakeHour).padStart(2, '0')}:${String(wakeMin).padStart(2, '0')}`;
        
        // Screen time between 1 and 6 hours
        const screenTime = Math.round((1 + Math.random() * 5) * 10) / 10;
        
        const log = {
            date: dateStr,
            wakeupTime: wakeupTime,
            learningDone: learningDone,
            learningHours: learningHours,
            learnedToday: learningDone ? topics[Math.floor(Math.random() * topics.length)] : '',
            workoutDone: workoutDone,
            workoutType: workoutDone ? workoutTypes[Math.floor(Math.random() * workoutTypes.length)] : 'gym',
            screenTime: screenTime,
            mood: moods[Math.floor(Math.random() * moods.length)],
            mit1Text: 'Complete main task',
            mit1Done: Math.random() > 0.3,
            mit2Text: 'Review and plan',
            mit2Done: Math.random() > 0.4,
            mit3Text: 'Learn something new',
            mit3Done: learningDone,
            dayState: dayState,
            locked: true,
            completionPercent: dayState === 'COMPLETED' ? 100 : dayState === 'PARTIAL' ? Math.floor(40 + Math.random() * 40) : 0
        };
        
        testData.push(log);
    }
    
    // Save to backend if available
    if (useBackend) {
        try {
            for (const log of testData) {
                await API.saveToday(log);
            }
            
            // Reload data
            await loadFromBackend();
            updateDashboard();
            
            showNotification('Test data generated! Check History view.', 'success');
        } catch (err) {
            console.error('Failed to generate test data:', err);
            showNotification('Failed to generate test data', 'error');
        }
    } else {
        // Save to localStorage
        testData.forEach(log => {
            const existingIdx = dashboardData.dailyLogs.findIndex(l => l.date === log.date);
            const localLog = {
                date: log.date,
                wakeUp: log.wakeupTime,
                learned: log.learnedToday,
                learningDone: log.learningDone,
                learningHours: log.learningHours,
                workout: log.workoutDone,
                workoutType: log.workoutType,
                screenTime: log.screenTime,
                mood: log.mood,
                mits: [log.mit1Text, log.mit2Text, log.mit3Text],
                mitsDone: [log.mit1Done, log.mit2Done, log.mit3Done]
            };
            
            if (existingIdx >= 0) {
                dashboardData.dailyLogs[existingIdx] = localLog;
            } else {
                dashboardData.dailyLogs.push(localLog);
            }
        });
        
        saveToStorage();
        updateDashboard();
        showNotification('Test data generated! Check History view.', 'success');
    }
}

/**
 * Confirm and reset all data
 */
function confirmResetAllData() {
    console.log('confirmResetAllData called');
    
    if (!confirm('⚠️ This will DELETE ALL your data permanently!\n\nAre you absolutely sure?')) {
        console.log('First confirmation cancelled');
        return;
    }
    
    if (!confirm('Final confirmation: All streaks, history, and settings will be lost. Continue?')) {
        console.log('Second confirmation cancelled');
        return;
    }
    
    console.log('Both confirmations passed, calling resetAllData');
    resetAllData();
}

/**
 * Reset all data
 */
async function resetAllData() {
    console.log('resetAllData called');
    closeSettingsModal();
    showNotification('Resetting all data...', 'warning');
    
    try {
        // Reset backend if available
        if (useBackend) {
            console.log('Calling backend reset via API...');
            try {
                const result = await API.resetAllData();
                console.log('Backend reset result:', result);
                
                if (!result.success) {
                    throw new Error('Backend reset returned failure');
                }
            } catch (err) {
                console.error('Backend reset failed:', err);
                showNotification('Backend reset failed: ' + err.message, 'error');
                // Don't continue if backend reset fails - data will just reload
                return;
            }
        } else {
            console.log('No backend, skipping server reset');
        }
        
        // Clear localStorage
        console.log('Clearing localStorage...');
        localStorage.removeItem('dashboardData');
        localStorage.removeItem('dashboardTheme');
        localStorage.removeItem('ai-tracker-settings');
        localStorage.removeItem('lastSaved');
        
        // Reset local state to fresh schema
        dashboardData = JSON.parse(JSON.stringify(SCHEMA));
        
        console.log('Reset complete, reloading page in 1.5s');
        showNotification('Data reset complete! Reloading...', 'success');
        
        // Reload page after a delay
        setTimeout(() => {
            console.log('Reloading now');
            window.location.reload(true); // Force reload from server
        }, 1500);
        
    } catch (err) {
        console.error('Reset error:', err);
        showNotification('Reset failed: ' + err.message, 'error');
    }
}

/**
 * Delete a specific day's log from history
 */
function deleteDayLog(dateStr) {
    const index = dashboardData.dailyLogs.findIndex(log => log.date === dateStr);
    if (index === -1) {
        showNotification('Day log not found', 'error');
        return false;
    }
    
    // Don't allow deleting today's log
    if (dateStr === getDateString()) {
        showNotification("Cannot delete today's log. Use 'Reset' to clear today.", 'warning');
        return false;
    }
    
    // Remove the log
    dashboardData.dailyLogs.splice(index, 1);
    saveToStorage();
    
    // Update UI
    updateHistoryView();
    updateDashboard();
    
    showNotification(`Deleted log for ${dateStr}`, 'success');
    return true;
}

/**
 * Edit a specific day's log
 */
function editDayLog(dateStr, updates) {
    const log = dashboardData.dailyLogs.find(l => l.date === dateStr);
    if (!log) {
        showNotification('Day log not found', 'error');
        return false;
    }
    
    // Apply updates
    Object.keys(updates).forEach(key => {
        if (log.hasOwnProperty(key) || key === 'hadInteraction' || key === 'savePressed') {
            log[key] = updates[key];
        }
    });
    
    saveToStorage();
    
    // Update UI if it's today
    if (dateStr === getDateString()) {
        updateDailyInputs();
        updateDayStateDisplay();
    }
    
    updateDashboard();
    showNotification(`Updated log for ${dateStr}`, 'success');
    return true;
}

/**
 * Export all data as JSON
 */
function exportData() {
    const dataStr = JSON.stringify(dashboardData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-tracker-backup-${getDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('Data exported successfully!', 'success');
}

/**
 * Import data from JSON file
 */
function importData(jsonData) {
    try {
        const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        
        // Validate structure
        if (!parsed.dailyLogs || !Array.isArray(parsed.dailyLogs)) {
            throw new Error('Invalid data format');
        }
        
        // Merge with current data (preserve newer entries)
        parsed.dailyLogs.forEach(importLog => {
            const existingIdx = dashboardData.dailyLogs.findIndex(l => l.date === importLog.date);
            if (existingIdx === -1) {
                // Add new log
                dashboardData.dailyLogs.push(importLog);
            }
            // Skip existing dates to preserve current data
        });
        
        // Sort logs by date
        dashboardData.dailyLogs.sort((a, b) => parseDate(a.date) - parseDate(b.date));
        
        saveToStorage();
        updateDashboard();
        
        showNotification(`Imported ${parsed.dailyLogs.length} days of data`, 'success');
        return true;
    } catch (err) {
        console.error('Import failed:', err);
        showNotification('Failed to import: ' + err.message, 'error');
        return false;
    }
}

/**
 * SAVE = "Finalize Today" (v11 NON-NEGOTIABLE)
 * 
 * Save is the ONLY commit action. Before save:
 * - Preview final result shown
 * - Day state is calculated
 * 
 * After save:
 * - Day is LOCKED (finalized)
 * - Inputs disabled
 * - Final state shown clearly
 * 
 * CRITICAL: Only deliberate actions change outcomes.
 */
async function saveNow() {
    const btn = document.getElementById('save-now-btn');
    if (!btn) return;
    
    const todayLog = getTodayLog();
    
    // Check if already finalized
    if (todayLog.finalized) {
        showNotification('Today is already finalized. Cannot save again.', 'warning');
        return;
    }
    
    // Show preview of what will happen
    const preview = previewFinalState(todayLog);
    const confirmMessage = preview.state === DAY_STATES.COMPLETED
        ? `Finalize today as COMPLETED? ✓ Streak will continue.`
        : `Finalize today as MISSED? (Missing: ${preview.missingHabits.join(', ')}) ✗ Streak will break.`;
    
    // Confirm before finalizing (optional - can remove for smoother UX)
    // if (!confirm(confirmMessage)) return;
    
    // Visual feedback - saving state
    btn.classList.add('saving');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Finalizing...</span>';
    
    try {
        // FINALIZE THE DAY - This is the critical action
        todayLog.finalized = true;
        todayLog.finalizedAt = new Date().toISOString();
        todayLog.lastInteraction = new Date().toISOString();
        
        // Calculate FINAL day state (now that it's finalized)
        const dayState = calculateDayState(todayLog);
        todayLog.finalState = dayState; // Store for History view
        
        // Update streaks based on FINAL state
        if (dayState === DAY_STATES.COMPLETED) {
            // All habits met - Streak INCREASES
            validateAndUpdateAllStreaks();
            console.log('[Save] Day COMPLETED - Streaks updated');
        } else if (dayState === DAY_STATES.MISSED) {
            // Habits not met - Streak BREAKS
            applyMissedDayPenalty();
            console.log('[Save] Day MISSED - Streaks penalized');
        }
        // NOT_COUNTED: This shouldn't happen after finalization
        
        // Calculate and update life score
        const score = calculateLifeScore();
        dashboardData.year.lifeScore = score;
        
        // Update last active date
        dashboardData.lastActiveDate = getDateString();
        
        // Save to localStorage
        localStorage.setItem('dashboardData', JSON.stringify(dashboardData));
        localStorage.setItem('lastSaved', new Date().toISOString());
        
        // Save to backend if available
        if (useBackend) {
            await saveToBackendSync();
        }
        
        // Success state
        btn.classList.remove('saving');
        btn.classList.add('saved');
        
        // Show final state with appropriate messaging
        const stateInfo = DAY_STATE_INFO[dayState];
        btn.innerHTML = `<i class="fas fa-lock"></i> <span>${stateInfo.label}</span>`;
        
        // Lock the UI inputs (day is finalized)
        lockDailyInputs();
        
        // Update UI
        updateDashboard();
        
        // Show notification with MITs quality info
        const mitsInfo = preview.mitsCompleted > 0 
            ? ` (${preview.mitsCompleted}/3 MITs done)` 
            : '';
        showNotification(`Day Finalized: ${stateInfo.label}${mitsInfo}`, 
            dayState === DAY_STATES.COMPLETED ? 'success' : 'warning');
        
    } catch (err) {
        console.error('Save failed:', err);
        todayLog.finalized = false; // Revert
        btn.classList.remove('saving');
        btn.classList.add('error');
        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>Error</span>';
        showNotification('Failed to finalize: ' + err.message, 'error');
    }
    
    // Reset button after 3 seconds (keep locked state visible longer)
    setTimeout(() => {
        btn.classList.remove('saved', 'error');
        if (todayLog.finalized) {
            btn.innerHTML = '<i class="fas fa-lock"></i> <span>Finalized</span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i class="fas fa-save"></i> <span>Finalize Day</span>';
        }
    }, 3000);
}

/**
 * Lock daily inputs after finalization
 */
function lockDailyInputs() {
    const todayLog = getTodayLog();
    if (!todayLog.finalized) return;
    
    // Disable all daily routine inputs
    const inputs = document.querySelectorAll('.daily-routine input, .daily-routine select, .daily-routine textarea');
    inputs.forEach(input => {
        input.disabled = true;
        input.classList.add('finalized');
    });
    
    // Visual indicator
    const dailySection = document.querySelector('.daily-routine');
    if (dailySection) {
        dailySection.classList.add('day-finalized');
    }
    
    // Update save button
    const saveBtn = document.getElementById('save-now-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-lock"></i> <span>Finalized</span>';
    }
}

/**
 * Apply penalty for a MISSED day
 */
function applyMissedDayPenalty() {
    const todayLog = getTodayLog();
    const today = getDateString();
    const sensitivity = settingsAuthority?.get('streaks.sensitivity') || 'normal';
    
    // Check each enabled habit
    const habits = ['learning', 'gym', 'sleep'];
    
    habits.forEach(habitId => {
        // Skip disabled habits
        const enabledKey = habitId === 'gym' ? 'nonNegotiables.gym.enabled' : 
                          habitId === 'sleep' ? 'nonNegotiables.sleep.enabled' : 
                          'nonNegotiables.learning.enabled';
        if (settingsAuthority?.get(enabledKey) === false) return;
        
        // Check if this specific habit is validated
        const isComplete = isHabitValidated(habitId, todayLog);
        
        if (!isComplete) {
            const history = dashboardData.streakHistory[habitId];
            
            // Skip if already processed today
            if (history.lastUpdated === today) return;
            
            // Apply penalty based on sensitivity
            if (sensitivity === 'strict') {
                // Strict: Break streak immediately
                if (dashboardData.streaks[habitId] > 0) {
                    history.best = Math.max(history.best, dashboardData.streaks[habitId]);
                }
                dashboardData.streaks[habitId] = 0;
                history.lastBroken = today;
                history.recoveryDays = 5;
            } else if (sensitivity === 'moderate') {
                // Moderate: Reduce streak by 50%
                dashboardData.streaks[habitId] = Math.floor(dashboardData.streaks[habitId] / 2);
            }
            // Lenient: No penalty on single miss
            
            history.lastUpdated = today;
        }
    });
}

/**
 * Save to backend synchronously (for manual save)
 */
async function saveToBackendSync() {
    if (!useBackend) return;
    
    const todayLog = getTodayLog();
    
    // Format for backend
    const payload = {
        date: todayLog.date,
        wakeupTime: todayLog.wakeUp,
        learningDone: todayLog.learningDone,
        learningHours: todayLog.learningHours,
        learnedToday: todayLog.learned,
        workoutDone: todayLog.workout,
        workoutType: todayLog.workoutType,
        screenTime: todayLog.screenTime,
        mood: todayLog.mood,
        mit1Text: todayLog.mits[0],
        mit1Done: todayLog.mitsDone[0],
        mit2Text: todayLog.mits[1],
        mit2Done: todayLog.mitsDone[1],
        mit3Text: todayLog.mits[2],
        mit3Done: todayLog.mitsDone[2],
        dayState: calculateDayState(todayLog),  // Auto-calculated only
        hadInteraction: todayLog.hadInteraction,
        bedtime: null,
        lifeScore: dashboardData.year.lifeScore
    };
    
    const result = await API.saveToday(payload);
    
    // Update cached week stats from backend response
    if (result.weekStats) {
        weeklyStatsCache = result.weekStats;
    }
    
    return result;
}

/**
 * Validate and update ALL streaks properly
 * ONLY updates streaks for ENABLED habits
 */
function validateAndUpdateAllStreaks() {
    const todayLog = getTodayLog();
    const today = getDateString();
    
    ['learning', 'gym', 'sleep'].forEach(habitId => {
        // SKIP DISABLED HABITS - they should not affect streaks
        const enabledKey = habitId === 'gym' ? 'nonNegotiables.gym.enabled' : 
                          habitId === 'sleep' ? 'nonNegotiables.sleep.enabled' : 
                          'nonNegotiables.learning.enabled';
        if (settingsAuthority?.get(enabledKey) === false) {
            console.log(`[Streak] Skipping disabled habit: ${habitId}`);
            return;
        }
        
        const history = dashboardData.streakHistory[habitId];
        
        // Skip if already updated today
        if (history.lastUpdated === today) {
            return;
        }
        
        // Check if habit is complete today
        const isComplete = checkHabitCompletion(habitId, todayLog);
        
        // Handle recovery period
        if (history.recoveryDays > 0) {
            if (isComplete) {
                history.recoveryDays--;
                // If recovery complete, start incrementing streak
                if (history.recoveryDays === 0) {
                    dashboardData.streaks[habitId] = 1;
                }
            }
            history.lastUpdated = today;
            return;
        }
        
        // Normal streak update
        if (isComplete) {
            dashboardData.streaks[habitId]++;
            
            // Update best if new record
            if (dashboardData.streaks[habitId] > history.best) {
                history.best = dashboardData.streaks[habitId];
            }
        }
        
        history.lastUpdated = today;
    });
    
    // Update UI
    updateStreakDisplays();
}

/**
 * Check if a habit is complete - uses isHabitValidated for consistency
 */
function checkHabitCompletion(habitId, log) {
    return isHabitValidated(habitId, log);
}

/**
 * Update streak displays in UI
 */
function updateStreakDisplays() {
    // Learning streak
    const learningStreak = dashboardData.streaks.learning || 0;
    const learningStreakEl = document.getElementById('learning-streak');
    const dailyLearningStreakEl = document.getElementById('daily-learning-streak');
    if (learningStreakEl) learningStreakEl.textContent = learningStreak;
    if (dailyLearningStreakEl) dailyLearningStreakEl.textContent = learningStreak;
    
    // Gym streak
    const gymStreak = dashboardData.streaks.gym || 0;
    const gymStreakEl = document.getElementById('gym-streak');
    const dailyWorkoutStreakEl = document.getElementById('daily-workout-streak');
    if (gymStreakEl) gymStreakEl.textContent = gymStreak;
    if (dailyWorkoutStreakEl) dailyWorkoutStreakEl.textContent = gymStreak;
    
    // Sleep streak
    const sleepStreak = dashboardData.streaks.sleep || 0;
    const sleepStreakEl = document.getElementById('sleep-streak');
    if (sleepStreakEl) sleepStreakEl.textContent = sleepStreak;
    
    // Apply recovery visual states
    applyRecoveryStates();
}

/**
 * Show notification toast
 */
function showNotification(message, type = 'info') {
    // Create toast element if needed
    let toast = document.getElementById('notification-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'notification-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 0.9rem;
            font-weight: 500;
            z-index: 10000;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
        `;
        document.body.appendChild(toast);
    }
    
    // Set type-specific styles
    const colors = {
        success: { bg: 'rgba(16, 185, 129, 0.9)', color: 'white' },
        error: { bg: 'rgba(239, 68, 68, 0.9)', color: 'white' },
        warning: { bg: 'rgba(245, 158, 11, 0.9)', color: 'white' },
        info: { bg: 'rgba(59, 130, 246, 0.9)', color: 'white' }
    };
    
    const style = colors[type] || colors.info;
    toast.style.background = style.bg;
    toast.style.color = style.color;
    toast.textContent = message;
    
    // Show toast
    gsap.to(toast, { opacity: 1, y: 0, duration: 0.3 });
    
    // Hide after 3 seconds
    setTimeout(() => {
        gsap.to(toast, { opacity: 0, y: 20, duration: 0.3 });
    }, 3000);
}

// Event Listeners
function initEventListeners() {
    // Theme toggle
    document.getElementById('theme-switch').addEventListener('click', toggleTheme);
    
    // Save button
    document.getElementById('save-now-btn')?.addEventListener('click', saveNow);
    
    // Settings modal
    document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal);
    document.getElementById('close-settings-modal')?.addEventListener('click', closeSettingsModal);
    document.getElementById('cancel-settings')?.addEventListener('click', closeSettingsModal);
    document.getElementById('save-settings')?.addEventListener('click', saveSettings);
    
    // Weight slider updates
    ['consistency', 'streaks', 'completion'].forEach(type => {
        document.getElementById(`weight-${type}`)?.addEventListener('input', updateWeightDisplays);
    });
    
    // Data management buttons
    const testDataBtn = document.getElementById('generate-test-data');
    const resetBtn = document.getElementById('reset-all-data');
    
    console.log('Data management buttons found:', { testDataBtn: !!testDataBtn, resetBtn: !!resetBtn });
    
    if (testDataBtn) {
        testDataBtn.addEventListener('click', () => {
            console.log('Generate test data clicked');
            generateTestData();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            console.log('Reset all data clicked');
            confirmResetAllData();
        });
    }
    
    // Add project
    document.getElementById('add-project').addEventListener('click', () => {
        document.getElementById('project-modal').classList.add('active');
    });
    
    document.getElementById('close-project-modal').addEventListener('click', () => {
        document.getElementById('project-modal').classList.remove('active');
    });
    
    document.getElementById('cancel-project').addEventListener('click', () => {
        document.getElementById('project-modal').classList.remove('active');
    });
    
    document.getElementById('save-project').addEventListener('click', addProject);
    
    // Wake-up time
    document.getElementById('wakeup-time').addEventListener('change', updateWakeupTime);
    
    // Learning toggle - with validation
    document.getElementById('learning-toggle').addEventListener('change', validateAndUpdateLearning);
    document.getElementById('learned-today').addEventListener('input', updateLearningTopic);
    document.getElementById('learning-hours-input').addEventListener('change', updateLearningHours);
    
    // Workout toggle - with validation
    document.getElementById('workout-toggle').addEventListener('change', validateAndUpdateWorkout);
    document.getElementById('workout-type').addEventListener('change', updateWorkoutType);
    
    // MITs - bind by ID instead of index to avoid conflicts with dynamic tasks
    for (let i = 1; i <= 3; i++) {
        const checkbox = document.getElementById(`mit-${i}`);
        const input = document.getElementById(`mit-input-${i}`);
        if (checkbox) checkbox.addEventListener('change', (e) => updateMIT(e.target));
        if (input) input.addEventListener('input', (e) => updateMITText(e.target));
    }
    
    // Add task
    document.getElementById('add-task-btn').addEventListener('click', addNewTask);
    
    // Initialize task list event delegation (survives updateTasksList calls)
    initTaskListEvents();
    
    // Screen time slider - bind by direct element reference to avoid DOM conflicts
    const screenTimeSlider = document.getElementById('screen-time-slider');
    if (screenTimeSlider) {
        screenTimeSlider.addEventListener('input', updateScreenTime);
    }
    
    // Mood selector - use event delegation to survive DOM updates
    document.addEventListener('click', function(e) {
        if (e.target.closest('.mood-option')) {
            const option = e.target.closest('.mood-option');
            selectMood(option);
        }
    });
    
    // Analytics period
    document.getElementById('analytics-period').addEventListener('change', updateAnalyticsPeriod);

    // Weekly targets edit - open modal instead of alert
    const editWeekly = document.getElementById('edit-weekly-targets');
    if (editWeekly) {
        editWeekly.addEventListener('click', () => {
            const modal = document.getElementById('weekly-targets-modal');
            const learningInput = document.getElementById('weekly-learning-input');
            const gymInput = document.getElementById('weekly-gym-input');
            
            // Pre-fill with current values
            learningInput.value = dashboardData.weeklyTargets.learningHours;
            gymInput.value = dashboardData.weeklyTargets.gymSessions;
            
            modal.classList.add('active');
        });
    }
    
    // Weekly targets modal handlers
    const weeklyModal = document.getElementById('weekly-targets-modal');
    const closeWeeklyBtn = document.getElementById('close-weekly-modal');
    const cancelWeeklyBtn = document.getElementById('cancel-weekly');
    const saveWeeklyBtn = document.getElementById('save-weekly');
    
    if (closeWeeklyBtn) {
        closeWeeklyBtn.addEventListener('click', () => {
            weeklyModal.classList.remove('active');
        });
    }
    
    if (cancelWeeklyBtn) {
        cancelWeeklyBtn.addEventListener('click', () => {
            weeklyModal.classList.remove('active');
        });
    }
    
    if (saveWeeklyBtn) {
        saveWeeklyBtn.addEventListener('click', () => {
            const learningInput = document.getElementById('weekly-learning-input');
            const gymInput = document.getElementById('weekly-gym-input');
            const newLearning = parseFloat(learningInput.value);
            const newGym = parseInt(gymInput.value);
            
            if (!isNaN(newLearning) && newLearning > 0) {
                dashboardData.weeklyTargets.learningHours = newLearning;
                showNotification(`Learning target set to ${newLearning}h/week`, 'success');
            }
            if (!isNaN(newGym) && newGym > 0) {
                dashboardData.weeklyTargets.gymSessions = newGym;
                showNotification(`Gym target set to ${newGym} sessions/week`, 'success');
            }
            
            saveToStorage();
            updateWeeklyStats();
            weeklyModal.classList.remove('active');
        });
    }
    
    // Bedtime tracker - check late night usage
    initBedtimeTracker();
}

/**
 * Validate and update learning toggle
 */
function validateAndUpdateLearning() {
    const toggle = document.getElementById('learning-toggle');
    const hours = parseFloat(document.getElementById('learning-hours-input').value) || 0;
    const topic = document.getElementById('learned-today').value || '';
    
    // If turning ON, validate (if toggleAuthority is available)
    if (toggle.checked && toggleAuthority) {
        try {
            // Build a dayLog-like object for validation
            const dayLog = {
                learningHours: hours,
                learned: topic,
                locked: getTodayLog().finalized
            };
            const validation = toggleAuthority.validateLearningToggle(dayLog);
            
            if (!validation.valid) {
                // Prevent toggle
                toggle.checked = false;
                
                // Show error
                showToggleError('learning', validation.errors[0]);
                return;
            }
        } catch (err) {
            console.warn('Toggle validation error:', err);
            // Continue without validation if it fails
        }
    }
    
    // Valid - proceed with update
    updateLearningStatus();
}

/**
 * Validate and update workout toggle
 */
function validateAndUpdateWorkout() {
    const toggle = document.getElementById('workout-toggle');
    const type = document.getElementById('workout-type').value;
    
    // If turning ON, validate (if toggleAuthority is available)
    if (toggle.checked && toggleAuthority) {
        try {
            // Build a dayLog-like object for validation
            const dayLog = {
                workoutType: type,
                locked: getTodayLog().finalized
            };
            const validation = toggleAuthority.validateGymToggle(dayLog);
            
            if (!validation.valid) {
                // Prevent toggle
                toggle.checked = false;
                
                // Show error
                showToggleError('workout', validation.errors[0]);
                return;
            }
        } catch (err) {
            console.warn('Toggle validation error:', err);
            // Continue without validation if it fails
        }
    }
    
    // Valid - proceed with update
    updateWorkoutStatus();
}

/**
 * Show toggle validation error
 */
function showToggleError(type, message) {
    const cardMap = {
        learning: '.learning-card',
        workout: '.workout-card'
    };
    
    const card = document.querySelector(cardMap[type]);
    if (!card) return;
    
    // Add shake animation
    card.classList.add('toggle-validation-error');
    setTimeout(() => card.classList.remove('toggle-validation-error'), 500);
    
    // Show hint
    let hint = card.querySelector('.toggle-requirement-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.className = 'toggle-requirement-hint';
        card.appendChild(hint);
    }
    
    hint.textContent = message;
    hint.classList.add('visible');
    
    // Hide after 3 seconds
    setTimeout(() => hint.classList.remove('visible'), 3000);
}

/**
 * Mark that user interacted with the app today
 * This is critical for day state calculation
 */
function markInteraction() {
    const todayLog = getTodayLog();
    todayLog.hadInteraction = true;
    todayLog.lastInteraction = new Date().toISOString();
}

/**
 * Get current day state - AUTO-CALCULATED ONLY
 * NO manual state selection allowed
 */
function getCurrentDayState() {
    const todayLog = getTodayLog();
    return calculateDayState(todayLog);
}

/**
 * Get current UI state (for display before finalization)
 */
function getCurrentUIState() {
    const todayLog = getTodayLog();
    return getUIState(todayLog);
}

/**
 * Calculate FINAL day state (only meaningful after save/finalize)
 * v11 STRICT RULES:
 * - NOT_COUNTED: Day not finalized → No consequence
 * - COMPLETED: Finalized + All habits valid → Streak+
 * - MISSED: Finalized + Habits invalid → Streak breaks
 */
function calculateDayState(log) {
    if (!log) return DAY_STATES.NOT_COUNTED;
    
    // CRITICAL: If day was never finalized, it's NOT_COUNTED
    // NOT_COUNTED = neutral, no streak change
    if (!log.finalized) {
        return DAY_STATES.NOT_COUNTED;
    }
    
    // Day was finalized - check requirements
    const enabledHabits = getEnabledRequiredHabits();
    
    // If no habits enabled, finalized day = COMPLETED
    if (enabledHabits.length === 0) {
        return DAY_STATES.COMPLETED;
    }
    
    // Check each enabled/required habit
    let allMet = true;
    for (const habit of enabledHabits) {
        if (!isHabitValidated(habit, log)) {
            allMet = false;
            break;
        }
    }
    
    return allMet ? DAY_STATES.COMPLETED : DAY_STATES.MISSED;
}

/**
 * Get UI state for display (before finalization)
 */
function getUIState(log) {
    if (!log) return DAY_STATES.NOT_STARTED;
    
    // If already finalized, show final state
    if (log.finalized) {
        return calculateDayState(log);
    }
    
    // Check if any data entered
    const hasData = hasAnyDataEntered(log);
    
    return hasData ? DAY_STATES.IN_PROGRESS : DAY_STATES.NOT_STARTED;
}

/**
 * Check if any data has been entered for a log
 */
function hasAnyDataEntered(log) {
    if (!log) return false;
    return log.learningDone || 
           log.workout || 
           (log.wakeUp && log.wakeUp !== dashboardData.settings.wakeupTarget) ||
           (log.screenTime && log.screenTime > 0) ||
           (log.learningHours && log.learningHours > 0) ||
           (log.mits && log.mits.some(m => m && m.trim() !== ''));
}

/**
 * Preview what the final state WOULD BE if saved now
 * Shows user the consequence before they commit
 */
function previewFinalState(log) {
    if (!log) return { state: DAY_STATES.NOT_COUNTED, missingHabits: [], mitsCompleted: 0 };
    
    const enabledHabits = getEnabledRequiredHabits();
    const missingHabits = [];
    let allMet = true;
    
    enabledHabits.forEach(habitId => {
        if (!isHabitValidated(habitId, log)) {
            allMet = false;
            missingHabits.push(getHabitDisplayName(habitId));
        }
    });
    
    // Count MITs completed (affects quality, not state)
    const mitsCompleted = (log.mitsDone || []).filter(Boolean).length;
    
    // Determine state:
    // - No habits enabled = COMPLETED (nothing to fail)
    // - All habits met = COMPLETED
    // - Any habit missing = MISSED
    let state;
    if (enabledHabits.length === 0) {
        state = DAY_STATES.COMPLETED; // No requirements = success
    } else {
        state = allMet ? DAY_STATES.COMPLETED : DAY_STATES.MISSED;
    }
    
    return { state, missingHabits, mitsCompleted };
}

/**
 * Get human-readable habit name
 */
function getHabitDisplayName(habitId) {
    const names = {
        learning: 'Learning',
        gym: 'Workout',
        sleep: 'Wake-up',
        screenTime: 'Screen Time'
    };
    return names[habitId] || habitId;
}

/**
 * Get list of habits that are ENABLED and REQUIRED
 */
function getEnabledRequiredHabits() {
    const habits = [];
    
    // Check each habit from settings
    const learningEnabled = settingsAuthority?.get('nonNegotiables.learning.enabled') !== false;
    if (learningEnabled) habits.push('learning');
    
    const gymEnabled = settingsAuthority?.get('nonNegotiables.gym.enabled') !== false;
    if (gymEnabled) habits.push('gym');
    
    const sleepEnabled = settingsAuthority?.get('nonNegotiables.sleep.enabled') !== false;
    if (sleepEnabled) habits.push('sleep');
    
    const screenEnabled = settingsAuthority?.get('nonNegotiables.screenTime.enabled') !== false;
    if (screenEnabled) habits.push('screenTime');
    
    return habits;
}

/**
 * Check if a specific habit is validated for a given log
 */
function isHabitValidated(habitId, log) {
    if (!log) return false;
    
    switch (habitId) {
        case 'learning':
            // Learning: toggle ON and hours > 0
            return log.learningDone && (log.learningHours || 0) > 0;
            
        case 'gym':
            // Gym: toggle ON
            return log.workout === true;
            
        case 'sleep':
            // Sleep: wakeup on time
            return wasWakeupOnTime(log);
            
        case 'screenTime':
            // Screen: under the goal limit
            const goal = dashboardData.settings.screenTimeGoal || 3;
            return (log.screenTime || 0) <= goal;
            
        default:
            return true;
    }
}

/**
 * Update Day State Display (v11 - LOGIC-AWARE)
 * 
 * Dashboard must clearly show:
 * - Today's status: Not Started / In Progress / Finalized
 * - Outcome preview: "If saved → COMPLETED" or "If saved → MISSED (missing: Gym)"
 * - Inaction meaning: "If you don't save → NOT COUNTED (neutral)"
 * 
 * Visual language:
 * - Completed → strong green
 * - Missed → warning red
 * - Not Counted → faded gray (neutral)
 */
function updateDayStateDisplay() {
    const todayLog = getTodayLog();
    const uiState = getCurrentUIState();
    const stateInfo = DAY_STATE_INFO[uiState] || DAY_STATE_INFO.NOT_STARTED;
    
    // Get preview of what would happen if saved now
    const preview = previewFinalState(todayLog);
    
    // Calculate completion percentage
    const enabledHabits = getEnabledRequiredHabits();
    let completed = 0;
    enabledHabits.forEach(habitId => {
        if (isHabitValidated(habitId, todayLog)) completed++;
    });
    const completionPercent = enabledHabits.length > 0 
        ? Math.round((completed / enabledHabits.length) * 100) 
        : 100;
    
    // Count MITs (affects quality, not completion)
    const mitsCompleted = (todayLog.mitsDone || []).filter(Boolean).length;
    const mitsFilled = (todayLog.mits || []).filter(m => m && m.trim() !== '').length;
    
    // Update header badge
    const stateBadge = document.getElementById('current-day-state');
    if (stateBadge) {
        // If finalized, show final state
        if (todayLog.finalized) {
            const finalState = calculateDayState(todayLog);
            const finalInfo = DAY_STATE_INFO[finalState];
            stateBadge.className = `day-state-badge current ${finalInfo.cssClass}`;
            stateBadge.innerHTML = `
                <span class="state-icon">${finalInfo.icon}</span>
                <span class="state-text">${finalInfo.label}</span>
                <span class="state-lock"><i class="fas fa-lock"></i></span>
            `;
            stateBadge.title = `Day finalized: ${finalInfo.description}`;
        } else {
            // Not finalized - show UI state with preview
            stateBadge.className = `day-state-badge current ${stateInfo.cssClass}`;
            
            // Build preview text
            let previewText = '';
            if (uiState === DAY_STATES.NOT_STARTED) {
                previewText = 'No data yet';
            } else if (uiState === DAY_STATES.IN_PROGRESS) {
                if (preview.state === DAY_STATES.COMPLETED) {
                    previewText = `${completionPercent}% → Will be COMPLETED`;
                } else {
                    previewText = `${completionPercent}% → Missing: ${preview.missingHabits.join(', ')}`;
                }
            }
            
            stateBadge.innerHTML = `
                <span class="state-icon">${stateInfo.icon}</span>
                <span class="state-text">${previewText || stateInfo.label}</span>
            `;
            stateBadge.title = stateInfo.description + (
                uiState === DAY_STATES.IN_PROGRESS 
                    ? `\\nIf saved now: ${DAY_STATE_INFO[preview.state].label}\\nIf not saved: Not Counted (neutral)`
                    : ''
            );
        }
    }
    
    // Update save button text based on state
    const saveBtn = document.getElementById('save-now-btn');
    if (saveBtn && !todayLog.finalized) {
        if (uiState === DAY_STATES.NOT_STARTED) {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> <span>Finalize Day</span>';
        } else if (preview.state === DAY_STATES.COMPLETED) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>Finalize ✓</span>';
            saveBtn.classList.add('will-complete');
            saveBtn.classList.remove('will-miss');
        } else {
            saveBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>Finalize (Incomplete)</span>';
            saveBtn.classList.add('will-miss');
            saveBtn.classList.remove('will-complete');
        }
    } else if (saveBtn && todayLog.finalized) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-lock"></i> <span>Finalized</span>';
    }
    
    // Update MITs count display (quality indicator)
    const mitsCount = document.querySelector('.mits-count');
    if (mitsCount) {
        mitsCount.textContent = `${mitsCompleted}/${mitsFilled || 3}`;
        mitsCount.className = 'mits-count';
        if (mitsCompleted === 3) {
            mitsCount.classList.add('high-quality');
        } else if (mitsCompleted >= 1) {
            mitsCount.classList.add('medium-quality');
        }
    }
}

// ============================================
// SLEEP DISCIPLINE - BEDTIME TRACKING
// ============================================
function initBedtimeTracker() {
    // Check every 5 minutes after 10 PM
    setInterval(() => {
        const now = new Date();
        const hour = now.getHours();
        const minutes = now.getMinutes();
        
        // After bedtime target (default 11:30 PM)
        const [targetHour, targetMin] = dashboardData.settings.bedtimeTarget.split(':').map(Number);
        
        if (hour > targetHour || (hour === targetHour && minutes >= targetMin)) {
            recordLateNight();
        }
    }, 300000); // 5 minutes
    
    // Also check on visibility change (when user returns to page)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkBedtimeViolation();
        }
    });
}

function checkBedtimeViolation() {
    const now = new Date();
    const hour = now.getHours();
    
    // Between midnight and 4 AM = definitely late
    if (hour >= 0 && hour < 4) {
        recordLateNight();
    }
    
    // After bedtime target
    const [targetHour, targetMin] = dashboardData.settings.bedtimeTarget.split(':').map(Number);
    if (hour > targetHour || (hour === targetHour && now.getMinutes() >= targetMin)) {
        // Mark today's (or yesterday's if past midnight) sleep as late
        const todayLog = getTodayLog();
        if (todayLog.sleptOnTime === null) {
            todayLog.sleptOnTime = false;
            applyBedtimeWarning();
            saveToStorage();
        }
    }
}

function recordLateNight() {
    const todayLog = getTodayLog();
    
    // Only record once per day
    if (todayLog.sleptOnTime === null) {
        todayLog.sleptOnTime = false;
        saveToStorage();
        applyBedtimeWarning();
    }
}

function applyBedtimeWarning() {
    const wakeupCard = document.querySelector('.wakeup-card');
    if (wakeupCard) {
        wakeupCard.classList.add('bedtime-violation');
        
        // Subtle pulse warning
        gsap.to(wakeupCard, {
            duration: 0.5,
            boxShadow: '0 0 20px rgba(239, 68, 68, 0.4)',
            repeat: 2,
            yoyo: true,
            ease: 'power2.inOut'
        });
    }
}

function markSleptOnTime() {
    const todayLog = getTodayLog();
    if (todayLog.sleptOnTime === null) {
        todayLog.sleptOnTime = true;
        saveToStorage();
    }
}

// Data Storage
function saveToStorage() {
    dashboardData.lastActiveDate = getDateString();
    
    // Always save to localStorage as fallback
    localStorage.setItem('dashboardData', JSON.stringify(dashboardData));
    localStorage.setItem('lastSaved', new Date().toISOString());
    
    // Also save to backend if available
    if (useBackend) {
        saveToBackend();
    }
}

function loadFromStorage() {
    const saved = localStorage.getItem('dashboardData');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            
            // Version migration
            if (!parsed.version || parsed.version < DATA_VERSION) {
                migrateData(parsed);
            } else {
                dashboardData = mergeWithSchema(parsed);
            }
            
            // Handle day change and inactivity gaps
            handleDayTransition();
            
        } catch (e) {
            console.error('Data corruption detected, resetting...', e);
            resetToDefaults();
        }
    } else {
        createTodayLog();
    }
}

function mergeWithSchema(data) {
    const merged = JSON.parse(JSON.stringify(SCHEMA));
    
    // Deep merge preserving schema structure
    Object.keys(merged).forEach(key => {
        if (data[key] !== undefined) {
            if (typeof merged[key] === 'object' && merged[key] !== null && !Array.isArray(merged[key])) {
                merged[key] = { ...merged[key], ...data[key] };
            } else {
                merged[key] = data[key];
            }
        }
    });
    
    merged.version = DATA_VERSION;
    return merged;
}

function migrateData(oldData) {
    console.log('Migrating data from version', oldData.version || 1, 'to', DATA_VERSION);
    
    // Start with schema defaults
    dashboardData = JSON.parse(JSON.stringify(SCHEMA));
    
    // Migrate compatible fields - PRESERVE ALL DATA
    if (oldData.year) dashboardData.year = { ...dashboardData.year, ...oldData.year };
    if (oldData.dailyLogs) {
        // Preserve ALL daily logs with proper format
        dashboardData.dailyLogs = oldData.dailyLogs.map(log => ({
            date: log.date,
            wakeUp: log.wakeUp || dashboardData.settings.wakeupTarget,
            sleptOnTime: log.sleptOnTime !== undefined ? log.sleptOnTime : null,
            learned: log.learned || '',
            learningDone: log.learningDone || false,
            learningHours: log.learningHours || 0,
            workout: log.workout || false,
            workoutType: log.workoutType || 'gym',
            screenTime: log.screenTime || 0,
            mood: log.mood || null,
            mits: log.mits || ['', '', ''],
            mitsDone: log.mitsDone || [false, false, false],
            tasks: log.tasks || [],
            archived: log.archived || false,
            // New interaction tracking fields
            hadInteraction: log.hadInteraction || log.manualState !== undefined || log.learningDone || log.workout,
            savePressed: log.savePressed || false,
            lastInteraction: log.lastInteraction || null
        }));
    }
    if (oldData.streaks) dashboardData.streaks = { ...dashboardData.streaks, ...oldData.streaks };
    if (oldData.streakHistory) {
        // Merge streak history with new fields
        ['learning', 'gym', 'sleep'].forEach(key => {
            if (oldData.streakHistory[key]) {
                dashboardData.streakHistory[key] = {
                    ...dashboardData.streakHistory[key],
                    ...oldData.streakHistory[key],
                    lastUpdated: oldData.streakHistory[key].lastUpdated || null
                };
            }
        });
    }
    if (oldData.weeklyTargets) dashboardData.weeklyTargets = { ...dashboardData.weeklyTargets, ...oldData.weeklyTargets };
    if (oldData.weekStart) dashboardData.weekStart = oldData.weekStart;
    if (oldData.lastActiveDate) dashboardData.lastActiveDate = oldData.lastActiveDate;
    if (oldData.settings) dashboardData.settings = { ...dashboardData.settings, ...oldData.settings };
    
    dashboardData.version = DATA_VERSION;
    saveToStorage();
    
    console.log('Migration complete - preserved', dashboardData.dailyLogs.length, 'daily logs');
}

function resetToDefaults() {
    dashboardData = JSON.parse(JSON.stringify(SCHEMA));
    createTodayLog();
    saveToStorage();
}

function handleDayTransition() {
    const today = getDateString();
    const lastActive = dashboardData.lastActiveDate;
    
    if (!lastActive) {
        createTodayLog();
        return;
    }
    
    const daysMissed = getDaysBetween(lastActive, today);
    
    if (daysMissed > 0) {
        // Archive yesterday's data
        archiveDay(lastActive);
        
        // Finalize the previous day's state
        finalizeDayState(lastActive);
        
        // Handle gap days (days with no log at all = NOT_COUNTED = neutral)
        if (daysMissed > 1) {
            handleInactivityGap(daysMissed);
        }
        
        // Create fresh today log
        createTodayLog();
    } else {
        // Same day, ensure today log exists
        const todayLog = dashboardData.dailyLogs.find(l => l.date === today);
        if (!todayLog) {
            createTodayLog();
        }
    }
}

/**
 * Finalize day state when day closes (auto-transition at midnight)
 * v11 RULE: Only finalized days affect streaks
 * Un-finalized days become NOT_COUNTED (neutral, streak paused)
 */
function finalizeDayState(dateStr) {
    const log = dashboardData.dailyLogs.find(l => l.date === dateStr);
    if (!log) return;
    
    // If already finalized (user pressed save), keep that state
    if (log.finalized) {
        const state = calculateDayState(log);
        console.log(`[Day Finalize] ${dateStr} = ${state} (user finalized)`);
        return;
    }
    
    // Day was NOT finalized by user - mark as NOT_COUNTED
    // This is the NEUTRAL state - streak is PAUSED, not broken
    log.finalState = DAY_STATES.NOT_COUNTED;
    log.archived = true;
    
    console.log(`[Day Finalize] ${dateStr} = NOT_COUNTED (no save, neutral - streak paused)`);
    // NO streak changes for NOT_COUNTED days
}

function archiveDay(dateStr) {
    const log = dashboardData.dailyLogs.find(l => l.date === dateStr);
    if (log && !log.archived) {
        log.archived = true;
    }
}

/**
 * Handle gap of multiple days without any logs
 * These are all NOT_COUNTED days - NO streak penalty (neutral)
 * v11 RULE: Only deliberate actions change outcomes.
 * Silence should never feel like punishment.
 */
function handleInactivityGap(daysMissed) {
    console.log(`[Gap] ${daysMissed} days without app activity - all treated as NOT_COUNTED (neutral)`);
    
    // v11 LOGIC: Days without save/finalize = NOT_COUNTED = Streak PAUSED
    // User doing nothing should never be punished
    // Only MISSED days (finalized but incomplete) break streaks
    
    // Create placeholder logs for gap days as NOT_COUNTED
    const today = new Date();
    for (let i = daysMissed - 1; i >= 1; i--) {
        const gapDate = new Date(today);
        gapDate.setDate(gapDate.getDate() - i);
        const gapDateStr = getDateString(gapDate);
        
        // Only create if doesn't exist
        if (!dashboardData.dailyLogs.find(l => l.date === gapDateStr)) {
            dashboardData.dailyLogs.push({
                date: gapDateStr,
                wakeUp: null,
                sleptOnTime: null,
                learned: '',
                learningDone: false,
                learningHours: 0,
                workout: false,
                workoutType: null,
                screenTime: 0,
                mood: null,
                mits: ['', '', ''],
                mitsDone: [false, false, false],
                tasks: [],
                archived: true,
                finalized: false,           // NOT finalized = NOT_COUNTED
                finalState: DAY_STATES.NOT_COUNTED,
                lastInteraction: null
            });
        }
    }
    
    saveToStorage();
}

function createTodayLog() {
    const today = new Date();
    const todayStr = getDateString(today);
    
    // Check if log already exists
    const existing = dashboardData.dailyLogs.find(l => l.date === todayStr);
    if (existing) return existing;
    
    const todayLog = {
        date: todayStr,
        wakeUp: dashboardData.settings.wakeupTarget,
        sleptOnTime: null, // null = not yet recorded
        learned: '',
        learningDone: false,
        learningHours: 0,
        workout: false,
        workoutType: 'gym',
        screenTime: 0,
        mood: null,
        mits: ['', '', ''],
        mitsDone: [false, false, false],
        tasks: [],
        archived: false,
        // v11 FINALIZATION TRACKING - Critical for day state
        finalized: false,       // Has user pressed "Finalize Day"?
        finalizedAt: null,      // When was it finalized?
        finalState: null,       // COMPLETED, MISSED, or NOT_COUNTED
        lastInteraction: null   // Timestamp of last interaction
    };
    
    dashboardData.dailyLogs.push(todayLog);
    
    // Trim old logs to prevent bloat (keep last 120 days)
    trimOldLogs();
    
    saveToStorage();
    return todayLog;
}

function trimOldLogs() {
    // Keep ALL logs - no automatic deletion
    // Only sort them chronologically
    dashboardData.dailyLogs.sort((a, b) => parseDate(a.date) - parseDate(b.date));
    
    // Log count for debugging
    console.log(`[Data] Total daily logs: ${dashboardData.dailyLogs.length}`);
}

function getTodayLog() {
    const today = getDateString();
    let log = dashboardData.dailyLogs.find(log => log.date === today);
    
    if (!log) {
        log = createTodayLog();
    }
    
    // Ensure critical arrays exist (defensive coding)
    if (!log.mits || !Array.isArray(log.mits)) log.mits = ['', '', ''];
    if (!log.mitsDone || !Array.isArray(log.mitsDone)) log.mitsDone = [false, false, false];
    if (!log.tasks || !Array.isArray(log.tasks)) log.tasks = [];
    
    return log;
}

function getYesterdayLog() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    
    return dashboardData.dailyLogs.find(log => log.date === yesterdayStr);
}

function getLogByDate(dateStr) {
    return dashboardData.dailyLogs.find(log => log.date === dateStr);
}

// ============================================
// DAY CHANGE WATCHER
// ============================================
function startDayChangeWatcher() {
    // Check every minute for day change
    setInterval(() => {
        const currentDate = getDateString();
        const todayLog = dashboardData.dailyLogs.find(l => l.date === currentDate);
        
        if (!todayLog || todayLog.archived) {
            // New day detected
            handleDayTransition();
            updateDashboard();
            applyDayTransitionAnimation();
        }
    }, 60000);
}

function applyDayTransitionAnimation() {
    // Subtle fade transition for new day
    gsap.fromTo('.dashboard-container', 
        { opacity: 0.7 },
        { opacity: 1, duration: 0.8, ease: 'power2.out' }
    );
}

// Update Functions
function updateDashboard() {
    updateYearStats();
    updateWeeklyStats();
    updateDailyInputs();
    updateStreaks();
    updateCharts();
    updateDayStateDisplay();
    
    // Lock inputs if today is already finalized
    const todayLog = getTodayLog();
    if (todayLog.finalized) {
        lockDailyInputs();
    }
}

function updateYearStats() {
    const todayLog = getTodayLog();
    
    // Update life score with new formula
    let score = calculateLifeScore();
    const lifeScoreEl = document.getElementById('life-score');
    if (lifeScoreEl) lifeScoreEl.textContent = `${score}%`;
    dashboardData.year.lifeScore = score;
    
    // Animate score ring
    const circle = document.querySelector('.score-ring-progress');
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    
    gsap.to(circle, {
        duration: 1.5,
        strokeDashoffset: offset,
        ease: "power2.out"
    });
    
    // Apply score-based visual state
    applyScoreVisuals(score);
    
    // Update skill hours
    let totalHours = 0;
    dashboardData.dailyLogs.forEach(log => {
        totalHours += log.learningHours || 0;
    });
    
    dashboardData.year.skillHours = totalHours;
    document.getElementById('total-skill-hours').textContent = Math.round(totalHours);
    document.getElementById('today-skill-hours').textContent = 
        `${todayLog.learningHours || 0}h`;
    
    // Update projects
    document.getElementById('projects-count').textContent = dashboardData.year.projects;
    
    // Update job status
    updateJobStatus();
}

// ============================================
// LIFE SCORE FORMULA (Strict)
// ============================================
function calculateLifeScore() {
    const todayLog = getTodayLog();
    // Use only finalized logs; if none, return 0 to avoid phantom scores
    const last7Days = getLast7DaysLogs().filter(l => l.finalized);
    if (last7Days.length === 0) return 0;
    
    let score = 0;
    let penalties = 0;
    
    // === LEARNING CONSISTENCY (Max 30 points) ===
    const learningDays = last7Days.filter(l => l.learningDone).length;
    const learningConsistency = (learningDays / 7) * 30;
    score += learningConsistency;
    
    // Penalty: No learning today when day is progressing
    const currentHour = new Date().getHours();
    if (currentHour >= 18 && !todayLog.learningDone) {
        penalties += 5; // Late day, no learning yet
    }
    
    // === WORKOUT CONSISTENCY (Max 20 points) ===
    const workoutDays = last7Days.filter(l => l.workout).length;
    const workoutConsistency = (workoutDays / 5) * 20; // 5 days target
    score += Math.min(workoutConsistency, 20);
    
    // === SLEEP DISCIPLINE (Max 20 points) ===
    const goodSleepDays = last7Days.filter(l => {
        if (!l.wakeUp) return false;
        const wakeupDate = new Date(`2000-01-01T${l.wakeUp}`);
        const targetDate = new Date(`2000-01-01T${dashboardData.settings.wakeupTarget}`);
        return (wakeupDate - targetDate) / 60000 <= 30; // Within 30 min of target
    }).length;
    score += (goodSleepDays / 7) * 20;
    
    // Penalty: Slept late (after bedtime target)
    const yesterdayLog = getYesterdayLog();
    if (yesterdayLog && yesterdayLog.sleptOnTime === false) {
        penalties += 8;
    }
    
    // === SCREEN TIME CONTROL (Max 15 points) ===
    const screenGoal = dashboardData.settings.screenTimeGoal;
    const avgScreenTime = last7Days.reduce((sum, l) => sum + (l.screenTime || 0), 0) / Math.max(last7Days.length, 1);
    
    if (avgScreenTime <= screenGoal) {
        score += 15;
    } else if (avgScreenTime <= screenGoal * 1.5) {
        score += 8;
    } else if (avgScreenTime <= screenGoal * 2) {
        score += 3;
        penalties += 5;
    } else {
        penalties += 10; // Heavy screen time penalty
    }
    
    // Immediate screen time penalty for today
    if (todayLog.screenTime > 5) {
        penalties += 8;
    } else if (todayLog.screenTime > 3) {
        penalties += 3;
    }
    
    // === MIT COMPLETION (Max 15 points) ===
    const mitCompletionRates = last7Days.map(l => {
        const done = (l.mitsDone || []).filter(Boolean).length;
        const total = (l.mits || []).filter(m => m.trim() !== '').length;
        return total > 0 ? done / total : 0;
    });
    const avgMitCompletion = mitCompletionRates.reduce((a, b) => a + b, 0) / Math.max(mitCompletionRates.length, 1);
    score += avgMitCompletion * 15;
    
    // === STREAK BONUSES (Max 10 points) ===
    const streakBonus = Math.min(
        (dashboardData.streaks.learning * 0.5) +
        (dashboardData.streaks.gym * 0.3) +
        (dashboardData.streaks.sleep * 0.2),
        10
    );
    score += streakBonus;
    
    // === RECOVERY PENALTY ===
    // If recovering from broken streak, reduce score gain
    const totalRecoveryDays = 
        (dashboardData.streakHistory.learning.recoveryDays || 0) +
        (dashboardData.streakHistory.gym.recoveryDays || 0) +
        (dashboardData.streakHistory.sleep.recoveryDays || 0);
    
    if (totalRecoveryDays > 0) {
        penalties += totalRecoveryDays * 2;
    }
    
    // Calculate final score
    const finalScore = Math.max(0, Math.min(100, Math.round(score - penalties)));
    
    return finalScore;
}

function getLast7DaysLogs() {
    const today = new Date();
    const logs = [];
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = getDateString(date);
        const log = dashboardData.dailyLogs.find(l => l.date === dateStr);
        if (log) logs.push(log);
    }
    
    return logs;
}

function applyScoreVisuals(score) {
    const scoreRing = document.querySelector('.score-ring-progress');
    const scoreContainer = document.querySelector('.life-score-container');
    
    // Remove previous state classes
    scoreContainer.classList.remove('score-critical', 'score-warning', 'score-good', 'score-excellent');
    
    if (score < 30) {
        scoreRing.style.stroke = 'var(--accent-danger)';
        scoreContainer.classList.add('score-critical');
    } else if (score < 50) {
        scoreRing.style.stroke = 'var(--accent-warning)';
        scoreContainer.classList.add('score-warning');
    } else if (score < 75) {
        scoreRing.style.stroke = 'var(--accent-primary)';
        scoreContainer.classList.add('score-good');
    } else {
        scoreRing.style.stroke = 'var(--accent-success)';
        scoreContainer.classList.add('score-excellent');
    }
}

function calculateWeeklyConsistency() {
    const weekStart = dashboardData.weekStart ? new Date(dashboardData.weekStart) : getMonday();
    const today = new Date();
    
    const weekLogs = dashboardData.dailyLogs.filter(log => {
        const logDate = parseDate(log.date);
        return logDate >= weekStart && logDate <= today;
    });
    
    if (weekLogs.length === 0) return 0;
    
    let consistency = 0;
    const daysInWeek = Math.min(getDaysBetween(weekStart, today) + 1, 7);
    
    weekLogs.forEach(log => {
        if (log.learningDone) consistency += 14; // 100/7 ≈ 14 per day
        if (log.workout) consistency += 8;
        if (log.mood && log.mood >= 3) consistency += 4;
        if (log.screenTime <= dashboardData.settings.screenTimeGoal) consistency += 3;
    });
    
    // Normalize to percentage
    const maxPossible = daysInWeek * 29; // 14+8+4+3 = 29 per day
    return Math.min(Math.round((consistency / maxPossible) * 100), 100);
}

function updateJobStatus() {
    const jobStatusEl = document.getElementById('job-status');
    const jobProgressEl = document.getElementById('job-progress');
    
    // Calculate progress based on skill hours and projects
    const hoursProgress = Math.min(dashboardData.year.skillHours / 1000 * 100, 70);
    const projectsProgress = Math.min(dashboardData.year.projects / 10 * 100, 30);
    const totalProgress = hoursProgress + projectsProgress;
    
    // Animate progress bar
    gsap.to(jobProgressEl, {
        duration: 1,
        width: `${totalProgress}%`,
        ease: "power2.out"
    });
    
    // Update status if unlocked
    if (totalProgress >= 100 && !dashboardData.year.jobStatus) {
        dashboardData.year.jobStatus = true;
        jobStatusEl.classList.remove('locked');
        jobStatusEl.classList.add('unlocked');
        jobStatusEl.querySelector('.status-icon').innerHTML = '<i class="fas fa-unlock"></i>';
        jobStatusEl.querySelector('.status-text').textContent = 'UNLOCKED';
        
        // Celebration animation
        gsap.to(jobStatusEl, {
            duration: 0.5,
            scale: 1.1,
            repeat: 3,
            yoyo: true,
            ease: "power2.inOut"
        });
    }
}

function updateWeeklyStats() {
    // If backend is available and we have cached stats, use those
    if (useBackend && weeklyStatsCache) {
        updateWeeklyStatsFromBackend();
        updateDayBars();
        return;
    }
    
    // Fallback to localStorage-based calculation
    const today = new Date();
    const weekStart = dashboardData.weekStart ? new Date(dashboardData.weekStart) : getMonday();
    
    const weekLogs = dashboardData.dailyLogs.filter(log => {
        const logDate = parseDate(log.date);
        return logDate >= weekStart && logDate <= today;
    });
    
    // Calculate learning hours - sum of ALL learning hours in current week
    let learningHours = 0;
    weekLogs.forEach(log => {
        learningHours += parseFloat(log.learningHours) || 0;
    });
    
    const learningTarget = dashboardData.weeklyTargets.learningHours;
    const learningPercent = Math.min((learningHours / learningTarget) * 100, 100);
    
    // Update learning display with proper formatting
    const learningHoursEl = document.getElementById('learning-hours');
    if (learningHoursEl) {
        learningHoursEl.textContent = `${Math.round(learningHours * 10) / 10}h`;
    }
    
    // Animate learning progress bar
    const learningProgress = document.getElementById('learning-progress');
    if (learningProgress) {
        gsap.to(learningProgress, {
            width: `${learningPercent}%`,
            duration: 0.8,
            ease: 'power2.out'
        });
        
        // Apply visual state classes
        learningProgress.classList.remove('on-track', 'behind', 'critical');
        if (learningPercent >= 70) {
            learningProgress.classList.add('on-track');
        } else if (learningPercent >= 40) {
            learningProgress.classList.add('behind');
        } else {
            learningProgress.classList.add('critical');
        }
    }
    
    // Calculate gym sessions - count of workout days in current week
    let gymSessions = weekLogs.filter(log => log.workout === true).length;
    const gymTarget = dashboardData.weeklyTargets.gymSessions;
    const gymPercent = Math.min((gymSessions / gymTarget) * 100, 100);
    
    // Update gym display
    const gymSessionsEl = document.getElementById('gym-sessions');
    if (gymSessionsEl) {
        gymSessionsEl.textContent = gymSessions;
    }
    
    // Animate gym progress bar
    const gymProgress = document.getElementById('gym-progress');
    if (gymProgress) {
        gsap.to(gymProgress, {
            width: `${gymPercent}%`,
            duration: 0.8,
            ease: 'power2.out'
        });
        
        // Apply visual state classes
        gymProgress.classList.remove('on-track', 'behind', 'critical');
        if (gymPercent >= 70) {
            gymProgress.classList.add('on-track');
        } else if (gymPercent >= 40) {
            gymProgress.classList.add('behind');
        } else {
            gymProgress.classList.add('critical');
        }
    }
    
    // Update weekly consistency
    const consistency = calculateWeeklyConsistency();
    const weeklyEl = document.getElementById('weekly-consistency');
    if (weeklyEl) weeklyEl.textContent = `${consistency}%`;
    
    // Update week reset info
    const daysUntilReset = 7 - (today.getDay() || 7);
    document.getElementById('week-reset-info').textContent = 
        daysUntilReset === 0 ? 'Resets tomorrow' : `Auto-resets in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''}`;
    
    // Week range display
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekRangeEl = document.getElementById('week-range');
    if (weekRangeEl) {
        const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        weekRangeEl.textContent = `${startStr} - ${endStr}`;
    }
    
    // Update day bars
    updateDayBars();
}

function updateDayBars() {
    const weekStart = dashboardData.weekStart ? new Date(dashboardData.weekStart) : getMonday();
    const today = new Date();
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    
    // Map week starting from Monday
    const weekDayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    
    weekDayOrder.forEach((day, index) => {
        const bar = document.querySelector(`.day-bar.${day}`);
        if (!bar) return;
        
        let height = 0;
        
        // Calculate date for this day of the week
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + index);
        
        if (dayDate <= today) {
            const dateStr = getDateString(dayDate);
            const dayLog = dashboardData.dailyLogs.find(log => log.date === dateStr);
            
            if (dayLog) {
                let dayScore = 0;
                if (dayLog.learningDone) dayScore += 40;
                if (dayLog.workout) dayScore += 30;
                if (dayLog.mood && dayLog.mood >= 3) dayScore += 15;
                if (dayLog.screenTime <= dashboardData.settings.screenTimeGoal) dayScore += 15;
                height = Math.min(dayScore, 100);
            }
        }
        
        const fillEl = bar.querySelector('.day-bar-fill');
        if (fillEl) {
            gsap.to(fillEl, {
                duration: 0.8,
                height: `${height}%`,
                delay: index * 0.08,
                ease: "power2.out"
            });
            
            // Color based on performance
            if (height >= 80) {
                fillEl.style.background = 'linear-gradient(to top, var(--accent-success), var(--accent-primary))';
            } else if (height >= 50) {
                fillEl.style.background = 'linear-gradient(to top, var(--accent-primary), var(--accent-secondary))';
            } else if (height > 0) {
                fillEl.style.background = 'linear-gradient(to top, var(--accent-warning), var(--accent-primary))';
            }
        }
    });
}

/**
 * Show/hide daily routine cards based on Settings
 * This is the ONLY place that controls card visibility
 */
function applyHabitVisibility() {
    // Learning card
    const learningCard = document.querySelector('.learning-card');
    const learningEnabled = settingsAuthority?.get('nonNegotiables.learning.enabled') !== false;
    if (learningCard) {
        learningCard.style.display = learningEnabled ? '' : 'none';
    }
    
    // Workout card
    const workoutCard = document.querySelector('.workout-card');
    const gymEnabled = settingsAuthority?.get('nonNegotiables.gym.enabled') !== false;
    if (workoutCard) {
        workoutCard.style.display = gymEnabled ? '' : 'none';
    }
    
    // Wakeup card (sleep)
    const wakeupCard = document.querySelector('.wakeup-card');
    const sleepEnabled = settingsAuthority?.get('nonNegotiables.sleep.enabled') !== false;
    if (wakeupCard) {
        wakeupCard.style.display = sleepEnabled ? '' : 'none';
    }
    
    // Screen time card
    const screenCard = document.querySelector('.screen-card');
    const screenEnabled = settingsAuthority?.get('nonNegotiables.screenTime.enabled') !== false;
    if (screenCard) {
        screenCard.style.display = screenEnabled ? '' : 'none';
    }
    
    console.log('[Visibility] Habits:', { learningEnabled, gymEnabled, sleepEnabled, screenEnabled });
}

function updateDailyInputs() {
    const todayLog = getTodayLog();
    
    // FIRST: Apply habit visibility from Settings
    applyHabitVisibility();
    
    // Wake-up time - use today's wakeup or target as fallback
    const wakeupInput = document.getElementById('wakeup-time');
    const wakeupTime = todayLog.wakeUp || dashboardData.settings.wakeupTarget;
    if (wakeupInput) wakeupInput.value = wakeupTime;
    updateWakeupStatus(wakeupTime);
    
    // Learning
    document.getElementById('learning-toggle').checked = todayLog.learningDone;
    document.getElementById('learned-today').value = todayLog.learned || '';
    document.getElementById('learning-hours-input').value = todayLog.learningHours || 1;
    
    // Workout
    document.getElementById('workout-toggle').checked = todayLog.workout;
    document.getElementById('workout-type').value = todayLog.workoutType || 'gym';
    
    // MITs - ensure arrays exist
    const mits = todayLog.mits || ['', '', ''];
    const mitsDone = todayLog.mitsDone || [false, false, false];
    let completedMits = 0;
    mits.forEach((mit, index) => {
        const input = document.getElementById(`mit-input-${index + 1}`);
        const checkbox = document.getElementById(`mit-${index + 1}`);
        if (!input || !checkbox) return;
        
        const mitItem = checkbox.closest('.mit-item');
        
        input.value = mit || '';
        checkbox.checked = mitsDone[index] || false;
        
        // Apply completed class if checked
        if (mitsDone[index]) {
            if (mitItem) mitItem.classList.add('completed');
            completedMits++;
        } else {
            if (mitItem) mitItem.classList.remove('completed');
        }
    });
    
    // Update MIT count display
    const mitsCount = document.querySelector('.mits-count');
    if (mitsCount) {
        mitsCount.textContent = `${completedMits}/3`;
    }
    
    // Tasks
    updateTasksList();
    
    // Screen time
    document.getElementById('screen-time-slider').value = todayLog.screenTime || 0;
    document.getElementById('screen-time-value').textContent = todayLog.screenTime || 0;
    updateScreenStatus(todayLog.screenTime);
    
    // Mood
    if (todayLog.mood) {
        const moodOption = document.querySelector(`.mood-option[data-value="${todayLog.mood}"]`);
        if (moodOption) {
            selectMood(moodOption, false);
        }
    }
}

function updateWakeupStatus(wakeupTime) {
    const statusEl = document.getElementById('wakeup-status');
    const targetTime = dashboardData.settings.wakeupTarget;
    const statusText = document.getElementById('wakeup-status-text');
    
    if (statusText) {
        statusText.textContent = `Target: ${targetTime}`;
    }
    
    if (!wakeupTime) {
        // No wakeup time entered yet
        if (statusEl) {
            statusEl.style.color = 'var(--text-secondary)';
            statusEl.classList.remove('streak-breaking');
        }
        return;
    }
    
    const wakeupDate = new Date(`2000-01-01T${wakeupTime}`);
    const targetDate = new Date(`2000-01-01T${targetTime}`);
    
    const diffMinutes = (wakeupDate - targetDate) / (1000 * 60);
    
    let statusClass = 'success';
    let statusIndicator = 'On target';
    
    if (diffMinutes > 30) {
        statusIndicator = `Late by ${Math.round(diffMinutes)}min`;
        statusClass = 'danger';
        
        // Visual shame for being late
        if (statusEl) {
            statusEl.classList.add('streak-breaking');
            setTimeout(() => {
                statusEl.classList.remove('streak-breaking');
            }, 800);
        }
    } else if (diffMinutes > 15) {
        statusIndicator = `A bit late (${Math.round(diffMinutes)}min)`;
        statusClass = 'warning';
    } else if (diffMinutes < -15) {
        statusIndicator = `Early by ${Math.round(-diffMinutes)}min`;
        statusClass = 'success';
        
        // Visual reward for being early
        if (statusEl) {
            gsap.to(statusEl, {
                duration: 0.3,
                scale: 1.1,
                color: 'var(--accent-success)',
                yoyo: true,
                repeat: 1
            });
        }
    }
    
    if (statusEl) {
        const statusDot = statusEl.querySelector('.status-dot');
        if (statusDot) {
            statusDot.style.backgroundColor = 
                statusClass === 'success' ? 'var(--accent-success)' :
                statusClass === 'warning' ? 'var(--accent-warning)' :
                'var(--accent-danger)';
        }
    }
}

// ============================================
// STREAK AUTHORITY SYSTEM (FIXED - ISOLATED STREAKS)
// ============================================

/**
 * Update a SINGLE habit's streak - NO side effects on other habits
 */
function updateSingleHabitStreak(habitId) {
    const todayLog = getTodayLog();
    const today = getDateString();
    const streakKey = habitId === 'gym' ? 'gym' : habitId;
    const history = dashboardData.streakHistory[streakKey];
    
    // Skip if already updated today
    if (history.lastUpdated === today) {
        console.log(`[Streak] ${habitId} already updated today`);
        updateStreakUI(habitId);
        return;
    }
    
    // Check if habit is complete
    const isComplete = checkHabitCompletion(habitId, todayLog);
    
    // Handle recovery period
    if (history.recoveryDays > 0) {
        if (isComplete) {
            history.recoveryDays--;
            console.log(`[Streak] ${habitId} recovery days remaining:`, history.recoveryDays);
            if (history.recoveryDays === 0) {
                // Recovery complete, start fresh streak
                dashboardData.streaks[streakKey] = 1;
            }
        }
        history.lastUpdated = today;
        updateStreakUI(habitId);
        saveToStorage();
        return;
    }
    
    // Normal streak update
    if (isComplete) {
        dashboardData.streaks[streakKey]++;
        console.log(`[Streak] ${habitId} incremented to:`, dashboardData.streaks[streakKey]);
        
        // Update best if new record
        if (dashboardData.streaks[streakKey] > history.best) {
            history.best = dashboardData.streaks[streakKey];
        }
    }
    
    history.lastUpdated = today;
    
    // Update ONLY this habit's UI elements
    updateStreakUI(habitId);
    updateHabitCardVisuals(habitId);
    saveToStorage();
}

/**
 * Update streak UI for a specific habit only
 */
function updateStreakUI(habitId) {
    const streakKey = habitId === 'gym' ? 'gym' : habitId;
    const value = dashboardData.streaks[streakKey] || 0;
    
    const uiMap = {
        learning: ['learning-streak', 'daily-learning-streak'],
        gym: ['gym-streak', 'daily-workout-streak'],
        sleep: ['sleep-streak']
    };
    
    const elements = uiMap[streakKey] || [];
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });
    
    // Update visual state for this habit's card
    updateHabitCardVisuals(habitId);
}

/**
 * Update visual state for a habit card
 */
function updateHabitCardVisuals(habitId) {
    const cardMap = {
        learning: '.learning-card',
        gym: '.workout-card',
        sleep: '.wakeup-card'
    };
    
    const card = document.querySelector(cardMap[habitId]);
    if (!card) return;
    
    const todayLog = getTodayLog();
    const streakKey = habitId === 'gym' ? 'gym' : habitId;
    const streakData = {
        current: dashboardData.streaks[streakKey] || 0,
        recoveryDays: dashboardData.streakHistory[streakKey]?.recoveryDays || 0
    };
    
    const habitSystem = getHabitSystem();
    if (habitSystem) {
        const visuals = habitSystem.getHabitVisuals(habitId, todayLog, streakData);
        
        // Clear all state classes
        card.classList.remove('habit-disabled', 'habit-complete', 'habit-recovery', 
                              'habit-at-risk', 'habit-pending', 'streak-broken', 'in-recovery');
        
        // Apply new state class
        if (visuals) {
            card.classList.add(visuals.cssClass);
            if (visuals.inRecovery) {
                card.classList.add('in-recovery');
                card.style.setProperty('--recovery-progress', 
                    `${((5 - streakData.recoveryDays) / 5) * 100}%`);
            }
        }
    }
}

/**
 * Validate and update streaks at day change
 */
function validateAndUpdateStreaks() {
    const yesterdayLog = getYesterdayLog();
    if (!yesterdayLog) return;
    
    const habitSystem = getHabitSystem();
    
    // Check each habit INDEPENDENTLY
    ['learning', 'gym', 'sleep'].forEach(habitId => {
        const wasComplete = habitSystem ? 
            habitSystem.isHabitComplete(habitId, yesterdayLog) :
            checkLegacyCompletion(habitId, yesterdayLog);
        
        if (!wasComplete && dashboardData.streaks[habitId] > 0) {
            breakSingleStreak(habitId);
        }
    });
}

function checkLegacyCompletion(habitId, log) {
    switch (habitId) {
        case 'learning': return log.learningDone;
        case 'gym': return log.workout;
        case 'sleep': return wasWakeupOnTime(log);
        default: return false;
    }
}

/**
 * Break a SINGLE habit's streak
 */
async function breakSingleStreak(habitId) {
    const streakKey = habitId === 'gym' ? 'gym' : habitId;
    const currentStreak = dashboardData.streaks[streakKey];
    
    if (currentStreak === 0) return;
    
    // Update history
    if (currentStreak > dashboardData.streakHistory[streakKey].best) {
        dashboardData.streakHistory[streakKey].best = currentStreak;
    }
    
    dashboardData.streakHistory[streakKey].lastBroken = getDateString();
    dashboardData.streakHistory[streakKey].recoveryDays = Math.min(Math.ceil(currentStreak / 3), 5);
    dashboardData.streaks[streakKey] = 0;
    
    // Update backend if available
    if (useBackend) {
        const backendType = habitId === 'gym' ? 'workout' : habitId;
        try {
            await API.breakStreak(backendType);
        } catch (err) {
            console.error(`Failed to break ${habitId} streak in backend:`, err);
        }
    }
    
    // Apply visuals for THIS habit only
    applyStreakBreakVisuals(habitId);
    updateStreakUI(habitId);
    saveToStorage();
}

function applyStreakBreakVisuals(type) {
    const cardMap = {
        learning: '.learning-card',
        gym: '.workout-card',
        sleep: '.wakeup-card'
    };
    
    const card = document.querySelector(cardMap[type]);
    if (!card) return;
    
    // Add desaturated state
    card.classList.add('streak-broken');
    
    // Shake animation
    gsap.to(card, {
        duration: 0.1,
        x: -8,
        ease: 'power2.inOut',
        repeat: 5,
        yoyo: true,
        onComplete: () => {
            gsap.set(card, { x: 0 });
        }
    });
}

function wasWakeupOnTime(log) {
    if (!log || !log.wakeUp) return false;
    const wakeupDate = new Date(`2000-01-01T${log.wakeUp}`);
    const targetDate = new Date(`2000-01-01T${dashboardData.settings.wakeupTarget}`);
    return (wakeupDate - targetDate) / 60000 <= 30;
}

/**
 * LEGACY: updateStreaks - now just updates all UI without cross-effects
 */
function updateStreaks() {
    // Update streak displays
    updateStreakDisplays();
    
    // Apply visual states
    applyHabitCardStates();
    
    saveToStorage();
}

/**
 * Apply visual states to habit cards based on completion
 */
function applyHabitCardStates() {
    const todayLog = getTodayLog();
    
    // Learning card
    const learningCard = document.querySelector('.learning-card');
    if (learningCard) {
        learningCard.classList.remove('habit-complete', 'habit-recovery', 'habit-at-risk', 'streak-broken');
        if (todayLog.learningDone) {
            learningCard.classList.add('habit-complete');
        } else if (dashboardData.streakHistory.learning.recoveryDays > 0) {
            learningCard.classList.add('habit-recovery');
        } else if (new Date().getHours() >= 20 && !todayLog.learningDone) {
            learningCard.classList.add('habit-at-risk');
        }
    }
    
    // Workout card
    const workoutCard = document.querySelector('.workout-card');
    if (workoutCard) {
        workoutCard.classList.remove('habit-complete', 'habit-recovery', 'habit-at-risk', 'streak-broken');
        if (todayLog.workout) {
            workoutCard.classList.add('habit-complete');
        } else if (dashboardData.streakHistory.gym.recoveryDays > 0) {
            workoutCard.classList.add('habit-recovery');
        } else if (new Date().getHours() >= 20 && !todayLog.workout) {
            workoutCard.classList.add('habit-at-risk');
        }
    }
    
    // Wakeup/Sleep card
    const wakeupCard = document.querySelector('.wakeup-card');
    if (wakeupCard) {
        wakeupCard.classList.remove('habit-complete', 'habit-recovery', 'habit-at-risk', 'streak-broken');
        if (wasWakeupOnTime(todayLog)) {
            wakeupCard.classList.add('habit-complete');
        } else if (dashboardData.streakHistory.sleep.recoveryDays > 0) {
            wakeupCard.classList.add('habit-recovery');
        }
    }
}

async function incrementStreak(type) {
    const history = dashboardData.streakHistory[type];
    const today = getDateString();
    
    // Skip if already updated today
    if (history.lastUpdated === today) {
        return false;
    }
    
    // Check if still in recovery period
    if (history.recoveryDays > 0) {
        history.recoveryDays--;
        if (history.recoveryDays > 0) {
            // Still recovering, streak doesn't increment yet
            history.lastUpdated = today;
            return false;
        }
    }
    
    dashboardData.streaks[type]++;
    history.lastUpdated = today;
    
    // Check for new record
    if (dashboardData.streaks[type] > history.best) {
        history.best = dashboardData.streaks[type];
        // Could trigger celebration here
    }
    
    // Update backend if available
    if (useBackend) {
        const backendType = type === 'gym' ? 'workout' : type;
        try {
            await API.incrementStreak(backendType);
        } catch (err) {
            console.error('Failed to increment streak in backend:', err);
        }
    }
    
    return true;
}

// OLD updateStreaks - replaced by isolated updateSingleHabitStreak
// This now just refreshes UI without recalculating
function updateStreaksLegacy() {
    // Update UI only - calculations done per-habit
    document.getElementById('learning-streak').textContent = dashboardData.streaks.learning;
    document.getElementById('daily-learning-streak').textContent = dashboardData.streaks.learning;
    document.getElementById('gym-streak').textContent = dashboardData.streaks.gym;
    document.getElementById('daily-workout-streak').textContent = dashboardData.streaks.gym;
    document.getElementById('sleep-streak').textContent = dashboardData.streaks.sleep;
    
    applyRecoveryStates();
}

// REMOVED: Old updateSingleStreak that caused cross-effects
// Now using updateSingleHabitStreak which is fully isolated

function applyRecoveryStates() {
    const types = ['learning', 'gym', 'sleep'];
    const cardMap = {
        learning: '.learning-card',
        gym: '.workout-card',
        sleep: '.wakeup-card'
    };
    
    types.forEach(type => {
        const card = document.querySelector(cardMap[type]);
        if (!card) return;
        
        const recoveryDays = dashboardData.streakHistory[type].recoveryDays || 0;
        
        if (recoveryDays > 0) {
            card.classList.add('in-recovery');
            card.style.setProperty('--recovery-progress', `${((5 - recoveryDays) / 5) * 100}%`);
        } else {
            card.classList.remove('in-recovery');
        }
    });
}

// Event Handlers - ISOLATED TOGGLE UPDATES
// NOTE: Toggles mark interaction but DO NOT update streaks
// Streaks are only updated when SAVE is pressed

function updateWakeupTime() {
    const todayLog = getTodayLog();
    const wakeupInput = document.getElementById('wakeup-time');
    const newWakeupTime = wakeupInput.value;
    
    if (!newWakeupTime) return;
    
    todayLog.wakeUp = newWakeupTime;
    dashboardData.settings.wakeupTarget = newWakeupTime;
    
    markInteraction();
    updateWakeupStatus(newWakeupTime);
    saveToStorage();
    updateDayStateDisplay();
    updateHabitCardVisuals('sleep');
    showNotification(`Wake-up target updated to ${newWakeupTime}`, 'info');
}

function updateLearningStatus() {
    const todayLog = getTodayLog();
    const toggle = document.getElementById('learning-toggle');
    if (!toggle) return;
    
    const isDone = toggle.checked;
    todayLog.learningDone = isDone;
    
    // Mark interaction but DON'T update streak yet
    markInteraction();
    
    // Animation
    const learningCard = document.querySelector('.learning-card');
    if (learningCard && isDone) {
        gsap.to(learningCard, {
            duration: 0.3,
            borderColor: 'var(--accent-success)',
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.3)',
            yoyo: true,
            repeat: 1
        });
    }
    
    // Save immediately
    saveToStorage();
    
    // Update UI
    updateDayStateDisplay();
    updateHabitCardVisuals('learning');
    
    console.log('[Learning] Toggle set to:', isDone);
}

function updateLearningTopic() {
    const todayLog = getTodayLog();
    todayLog.learned = document.getElementById('learned-today').value;
    markInteraction();
    saveToStorage();
}

function updateLearningHours() {
    const todayLog = getTodayLog();
    todayLog.learningHours = parseFloat(document.getElementById('learning-hours-input').value);
    markInteraction();
    saveToStorage();
    updateDayStateDisplay();
}

function updateWorkoutStatus() {
    const todayLog = getTodayLog();
    const toggle = document.getElementById('workout-toggle');
    if (!toggle) return;
    
    const isDone = toggle.checked;
    todayLog.workout = isDone;
    
    // Mark interaction but DON'T update streak yet
    markInteraction();
    
    // Animation
    const workoutCard = document.querySelector('.workout-card');
    if (workoutCard && isDone) {
        gsap.to(workoutCard, {
            duration: 0.3,
            borderColor: 'var(--accent-success)',
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.3)',
            yoyo: true,
            repeat: 1
        });
    }
    
    // Save immediately
    saveToStorage();
    
    // Update UI
    updateDayStateDisplay();
    updateHabitCardVisuals('gym');
    
    console.log('[Workout] Toggle set to:', isDone);
}

function updateWorkoutType() {
    const todayLog = getTodayLog();
    todayLog.workoutType = document.getElementById('workout-type').value;
    saveToStorage();
}

function updateMIT(checkboxElement) {
    // Extract index from checkbox ID (mit-1, mit-2, mit-3)
    const checkboxId = checkboxElement.id || '';
    const index = parseInt(checkboxId.replace('mit-', '')) - 1;
    if (isNaN(index) || index < 0 || index > 2) return;
    
    const todayLog = getTodayLog();
    const checkbox = checkboxElement;
    const mitItem = checkbox.closest('.mit-item');
    
    // Ensure arrays exist
    if (!todayLog.mitsDone) todayLog.mitsDone = [false, false, false];
    if (!todayLog.mits) todayLog.mits = ['', '', ''];
    
    todayLog.mitsDone[index] = checkbox.checked;
    
    // Add/remove completed class for styling
    if (checkbox.checked && mitItem) {
        mitItem.classList.add('completed');
        gsap.to(mitItem, {
            duration: 0.3,
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            borderColor: 'var(--accent-success)',
            yoyo: true,
            repeat: 1
        });
    } else if (mitItem) {
        mitItem.classList.remove('completed');
    }
    
    // Update MIT count in header
    const completedCount = (todayLog.mitsDone || []).filter(Boolean).length;
    const mitsCount = document.querySelector('.mits-count');
    if (mitsCount) {
        mitsCount.textContent = `${completedCount}/3`;
    }
    
    saveToStorage();
    updateDayStateDisplay();
}

function updateMITText(inputElement) {
    // Extract index from input ID (mit-input-1, mit-input-2, mit-input-3)
    const inputId = inputElement.id || '';
    const index = parseInt(inputId.replace('mit-input-', '')) - 1;
    if (isNaN(index) || index < 0 || index > 2) return;
    
    const todayLog = getTodayLog();
    if (!todayLog.mits) todayLog.mits = ['', '', ''];
    
    todayLog.mits[index] = inputElement.value;
    saveToStorage();
    updateDayStateDisplay();
}

async function addNewTask() {
    // Show inline input instead of prompt
    const tasksList = document.getElementById('tasks-list');
    
    // Check if input already exists
    let existingInput = document.getElementById('new-task-input-container');
    if (existingInput) {
        existingInput.querySelector('input').focus();
        return;
    }
    
    // Create inline input
    const inputContainer = document.createElement('div');
    inputContainer.id = 'new-task-input-container';
    inputContainer.className = 'task-item task-input-item';
    inputContainer.innerHTML = `
        <input type="text" id="new-task-input" class="task-text-input" placeholder="Enter task..." autofocus>
        <button class="task-add-confirm" id="confirm-task"><i class="fas fa-check"></i></button>
        <button class="task-add-cancel" id="cancel-task"><i class="fas fa-times"></i></button>
    `;
    tasksList.appendChild(inputContainer);
    
    const input = document.getElementById('new-task-input');
    input.focus();
    
    // Handle confirm
    const confirmTask = async () => {
        const taskText = input.value.trim();
        if (taskText) {
            const todayLog = getTodayLog();
            
            // If using backend, save task there
            if (useBackend) {
                try {
                    const result = await API.addTask(taskText);
                    todayLog.tasks.push({
                        id: result.task.id,
                        text: taskText,
                        done: false
                    });
                } catch (err) {
                    console.error('Failed to add task to backend:', err);
                    todayLog.tasks.push({
                        text: taskText,
                        done: false
                    });
                }
            } else {
                todayLog.tasks.push({
                    text: taskText,
                    done: false
                });
            }
            
            saveToStorage();
        }
        inputContainer.remove();
        updateTasksList();
    };
    
    // Handle cancel
    const cancelTask = () => {
        inputContainer.remove();
    };
    
    document.getElementById('confirm-task').addEventListener('click', confirmTask);
    document.getElementById('cancel-task').addEventListener('click', cancelTask);
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmTask();
        if (e.key === 'Escape') cancelTask();
    });
}

function updateTasksList() {
    const todayLog = getTodayLog();
    const tasksList = document.getElementById('tasks-list');
    tasksList.innerHTML = '';
    
    todayLog.tasks.forEach((task, index) => {
        const taskItem = document.createElement('div');
        taskItem.className = 'task-item';
        taskItem.innerHTML = `
            <input type="checkbox" class="task-checkbox" ${task.done ? 'checked' : ''} data-index="${index}">
            <span class="task-text">${task.text}</span>
            <button class="task-remove" data-index="${index}"><i class="fas fa-times"></i></button>
        `;
        tasksList.appendChild(taskItem);
    });
    
    // Event listeners are handled by event delegation in initEventListeners
}

/**
 * Initialize task list event delegation
 * This is called once in initEventListeners() and survives updateTasksList() calls
 */
function initTaskListEvents() {
    const tasksList = document.getElementById('tasks-list');
    if (!tasksList) return;
    
    // Event delegation for task checkboxes
    tasksList.addEventListener('change', function(e) {
        if (e.target.classList.contains('task-checkbox')) {
            const index = parseInt(e.target.dataset.index);
            toggleTask(index);
        }
    });
    
    // Event delegation for task remove buttons
    tasksList.addEventListener('click', function(e) {
        if (e.target.closest('.task-remove')) {
            const button = e.target.closest('.task-remove');
            const index = parseInt(button.dataset.index);
            removeTask(index);
        }
    });
}

async function toggleTask(index) {
    const todayLog = getTodayLog();
    if (todayLog.tasks[index]) {
        todayLog.tasks[index].done = !todayLog.tasks[index].done;
        
        // Update backend if available
        if (useBackend && todayLog.tasks[index].id) {
            try {
                await API.updateTask(todayLog.tasks[index].id, {
                    completed: todayLog.tasks[index].done
                });
            } catch (err) {
                console.error('Failed to update task:', err);
            }
        }
        
        saveToStorage();
        updateDashboard();
    }
}

async function removeTask(index) {
    const todayLog = getTodayLog();
    if (todayLog.tasks[index]) {
        const taskId = todayLog.tasks[index].id;
        
        // Animation for removal
        const taskItem = document.querySelector(`.task-checkbox[data-index="${index}"]`)?.closest('.task-item');
        if (taskItem) {
            gsap.to(taskItem, {
                duration: 0.3,
                opacity: 0,
                height: 0,
                margin: 0,
                padding: 0,
                onComplete: async () => {
                    // Delete from backend if available
                    if (useBackend && taskId) {
                        try {
                            await API.deleteTask(taskId);
                        } catch (err) {
                            console.error('Failed to delete task:', err);
                        }
                    }
                    
                    todayLog.tasks.splice(index, 1);
                    updateTasksList();
                    saveToStorage();
                }
            });
        } else {
            // No animation element, just delete
            if (useBackend && taskId) {
                try {
                    await API.deleteTask(taskId);
                } catch (err) {
                    console.error('Failed to delete task:', err);
                }
            }
            todayLog.tasks.splice(index, 1);
            updateTasksList();
            saveToStorage();
        }
    }
}

function updateScreenTime() {
    const todayLog = getTodayLog();
    const sliderEl = document.getElementById('screen-time-slider');
    if (!sliderEl) {
        console.warn('Screen time slider not found');
        return;
    }
    
    const value = parseFloat(sliderEl.value);
    if (isNaN(value) || value < 0) {
        console.warn('Invalid screen time value:', value);
        return;
    }
    
    todayLog.screenTime = value;
    
    // Update all screentime displays
    const valueDisplay = document.getElementById('screen-time-value');
    if (valueDisplay) {
        valueDisplay.textContent = value.toFixed(1);
    }
    
    // Update status
    updateScreenStatus(value);
    
    // Mark that user interacted with screentime
    markInteraction();
    
    // Apply any penalties for high screentime
    applyScreenTimePunishment(value);
    
    // Save to storage
    saveToStorage();
    
    // Update UI displays
    updateDayStateDisplay();
    updateHabitCardVisuals('screenTime');
    
    // Update analytics charts
    updateCharts();
}

function updateScreenStatus(hours) {
    const statusEl = document.getElementById('screen-status');
    const screenCard = document.querySelector('.screen-card');
    const goal = dashboardData.settings.screenTimeGoal;
    
    // Remove previous states
    screenCard.classList.remove('screen-warning', 'screen-danger', 'screen-critical');
    
    if (hours === 0) {
        statusEl.querySelector('.status-text').textContent = 'No data today';
        statusEl.style.backgroundColor = 'transparent';
        statusEl.style.color = 'var(--text-secondary)';
    } else if (hours <= goal) {
        statusEl.querySelector('.status-text').textContent = 'Under goal ✓';
        statusEl.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
        statusEl.style.color = 'var(--accent-success)';
    } else if (hours <= goal + 2) { // 3-5 hours
        statusEl.querySelector('.status-text').textContent = 'Over goal - watch it';
        statusEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
        statusEl.style.color = 'var(--accent-warning)';
        screenCard.classList.add('screen-warning');
    } else { // >5 hours
        statusEl.querySelector('.status-text').textContent = 'Way over goal!';
        statusEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        statusEl.style.color = 'var(--accent-danger)';
        screenCard.classList.add('screen-critical');
        
        // Shame shake
        gsap.to(screenCard, {
            duration: 0.08,
            x: -5,
            ease: 'power2.inOut',
            repeat: 4,
            yoyo: true,
            onComplete: () => gsap.set(screenCard, { x: 0 })
        });
    }
}

function applyScreenTimePunishment(hours) {
    const goal = dashboardData.settings.screenTimeGoal;
    
    // Screen time affects streak recovery speed
    if (hours > goal * 2) {
        // Heavy usage - slow down all recovery
        ['learning', 'gym', 'sleep'].forEach(type => {
            if (dashboardData.streakHistory[type].recoveryDays > 0) {
                dashboardData.streakHistory[type].recoveryDays = Math.min(
                    dashboardData.streakHistory[type].recoveryDays + 1,
                    7
                );
            }
        });
    }
}

function selectMood(optionElement, save = true) {
    // Remove active class from all options
    document.querySelectorAll('.mood-option').forEach(opt => {
        opt.classList.remove('active');
    });
    
    // Add active class to selected option
    optionElement.classList.add('active');
    
    const value = parseInt(optionElement.dataset.value);
    document.getElementById('mood-score').textContent = value;
    
    // Animation
    gsap.to(optionElement, {
        duration: 0.3,
        scale: 1.1,
        yoyo: true,
        repeat: 1
    });
    
    if (save) {
        const todayLog = getTodayLog();
        todayLog.mood = value;
        saveToStorage();
        updateDashboard();
    }
}

async function addProject() {
    const name = document.getElementById('project-name').value.trim();
    const hours = parseInt(document.getElementById('project-hours').value);
    const status = document.getElementById('project-status').value;
    
    if (name) {
        // Add to backend if available
        if (useBackend) {
            try {
                const result = await API.addProject(name, hours, status);
                if (result.stats) {
                    dashboardData.year.projects = result.stats.count;
                    dashboardData.year.skillHours = result.stats.total_hours;
                }
            } catch (err) {
                console.error('Failed to add project to backend:', err);
                dashboardData.year.projects++;
                dashboardData.year.skillHours += hours;
            }
        } else {
            dashboardData.year.projects++;
            dashboardData.year.skillHours += hours;
        }
        
        // Close modal and reset form
        document.getElementById('project-modal').classList.remove('active');
        document.getElementById('project-name').value = '';
        document.getElementById('project-hours').value = 10;
        
        // Animation for new project
        const projectsCount = document.getElementById('projects-count');
        gsap.to(projectsCount, {
            duration: 0.5,
            scale: 1.3,
            color: 'var(--accent-success)',
            yoyo: true,
            repeat: 2,
            ease: "power2.inOut",
            onComplete: () => {
                projectsCount.style.color = '';
            }
        });
        
        saveToStorage();
        updateDashboard();
    }
}

// Charts
let skillHoursChart, disciplineChart, moodProductivityChart, screenTimeChart;

// Helper function to get computed CSS variable value
function getCSSVar(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function getChartColors() {
    return {
        primary: getCSSVar('--accent-primary') || '#3b82f6',
        secondary: getCSSVar('--accent-secondary') || '#8b5cf6',
        success: getCSSVar('--accent-success') || '#10b981',
        warning: getCSSVar('--accent-warning') || '#f59e0b',
        info: getCSSVar('--accent-info') || '#06b6d4',
        textSecondary: getCSSVar('--text-secondary') || '#64748b',
        borderColor: getCSSVar('--border-color') || '#e2e8f0'
    };
}

function initCharts() {
    const colors = getChartColors();
    
    // Skill Hours Chart
    const skillCtx = document.getElementById('skill-hours-chart').getContext('2d');
    skillHoursChart = new Chart(skillCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Skill Hours',
                data: [],
                borderColor: colors.primary,
                backgroundColor: colors.primary + '1a',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                },
                x: {
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                }
            }
        }
    });

    // Discipline Chart
    const disciplineCtx = document.getElementById('discipline-chart').getContext('2d');
    disciplineChart = new Chart(disciplineCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Consistency %',
                data: [],
                backgroundColor: colors.success,
                borderColor: colors.success,
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                },
                x: {
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                }
            }
        }
    });

    // Mood vs Productivity Chart
    const moodCtx = document.getElementById('mood-productivity-chart').getContext('2d');
    moodProductivityChart = new Chart(moodCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Mood',
                    data: [],
                    borderColor: colors.secondary,
                    backgroundColor: colors.secondary + '1a',
                    borderWidth: 2,
                    yAxisID: 'y',
                    tension: 0.4
                },
                {
                    label: 'Productivity',
                    data: [],
                    borderColor: colors.info,
                    backgroundColor: colors.info + '1a',
                    borderWidth: 2,
                    yAxisID: 'y1',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 1,
                    max: 5,
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: {
                        drawOnChartArea: false,
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                },
                x: {
                    grid: {
                        color: colors.borderColor
                    },
                    ticks: {
                        color: colors.textSecondary
                    }
                }
            }
        }
    });

    // Screen Time Chart - Line chart for better trend visualization
    const screenCtx = document.getElementById('screen-time-chart').getContext('2d');
    screenTimeChart = new Chart(screenCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Screen Time (hours)',
                    data: [],
                    borderColor: colors.warning,
                    backgroundColor: colors.warning + '20',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointBackgroundColor: colors.warning,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 7,
                    pointHoverBackgroundColor: colors.warning,
                    yAxisID: 'y'
                },
                {
                    label: 'Goal (3h)',
                    data: [],
                    borderColor: colors.success,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        usePointStyle: true,
                        color: colors.textSecondary,
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: colors.warning,
                    borderWidth: 1,
                    padding: 10,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `Actual: ${context.raw.toFixed(1)}h`;
                            } else {
                                return `Goal: ${context.raw}h`;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 8,
                    grid: {
                        color: colors.borderColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: colors.textSecondary,
                        callback: function(value) {
                            return value + 'h';
                        }
                    }
                },
                x: {
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        color: colors.textSecondary,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

async function updateCharts() {
    const period = parseInt(document.getElementById('analytics-period').value);
    
    // If using backend, fetch fresh analytics data
    if (useBackend) {
        try {
            const analyticsData = await API.getAnalytics(period);
            if (analyticsData.daily && analyticsData.daily.length > 0) {
                // Update local cache with fresh data
                analyticsData.daily.forEach(log => {
                    const existingIdx = dashboardData.dailyLogs.findIndex(l => l.date === log.date);
                    const mappedLog = {
                        date: log.date,
                        wakeUp: log.wakeup_time || dashboardData.settings.wakeupTarget,
                        sleptOnTime: null,
                        learned: log.learned_today || '',
                        learningDone: !!log.learning_done,
                        learningHours: log.learning_hours || 0,
                        workout: !!log.workout_done,
                        workoutType: log.workout_type || 'gym',
                        screenTime: log.screen_time || 0,
                        mood: log.mood || null,
                        mits: [log.mit_1_text || '', log.mit_2_text || '', log.mit_3_text || ''],
                        mitsDone: [!!log.mit_1_done, !!log.mit_2_done, !!log.mit_3_done],
                        tasks: [],
                        archived: true
                    };
                    
                    if (existingIdx >= 0) {
                        dashboardData.dailyLogs[existingIdx] = mappedLog;
                    } else {
                        dashboardData.dailyLogs.push(mappedLog);
                    }
                });
            }
        } catch (err) {
            console.error('Failed to fetch analytics:', err);
        }
    }
    
    // Get logs for the selected period only (performance optimization)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);
    
    const logs = dashboardData.dailyLogs
        .filter(log => parseDate(log.date) >= cutoffDate)
        .sort((a, b) => parseDate(a.date) - parseDate(b.date))
        .slice(-period); // Ensure we don't exceed period
    
    if (logs.length === 0) {
        // No data - show empty state
        return;
    }
    
    // Prepare labels (dates)
    const labels = logs.map(log => {
        const date = parseDate(log.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    
    // Skill Hours data
    const skillHoursData = logs.map(log => log.learningHours || 0);
    
    // Discipline data
    const disciplineData = logs.map(log => {
        let score = 0;
        if (log.learningDone) score += 40;
        if (log.workout) score += 30;
        if (log.mood && log.mood >= 3) score += 15;
        if (log.screenTime <= dashboardData.settings.screenTimeGoal) score += 15;
        return score;
    });
    
    // Mood and Productivity data
    const moodData = logs.map(log => log.mood || null).filter(m => m !== null);
    const moodLabels = logs.filter(log => log.mood).map(log => {
        const date = parseDate(log.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    
    const productivityData = logs.map(log => {
        let prod = 0;
        if (log.learningDone) prod += 30;
        prod += Math.min((log.learningHours || 0) * 8, 30);
        if (log.workout) prod += 20;
        prod += log.mitsDone.filter(done => done).length * 7;
        return Math.min(prod, 100);
    });
    
    // Screen Time data with per-day visualization
    const screenData = logs.map(log => log.screenTime || 0);
    const goalLine = logs.map(() => dashboardData.settings.screenTimeGoal); // Horizontal goal reference
    
    // Update charts with animation
    updateChartWithAnimation(skillHoursChart, labels, skillHoursData);
    updateChartWithAnimation(disciplineChart, labels, disciplineData);
    
    // Mood chart needs special handling for missing data
    if (moodData.length > 0) {
        moodProductivityChart.data.labels = labels;
        moodProductivityChart.data.datasets[0].data = logs.map(log => log.mood || null);
        moodProductivityChart.data.datasets[1].data = productivityData;
        moodProductivityChart.update('active');
    }
    
    // Screen time line chart with trend visualization and goal reference line
    screenTimeChart.data.labels = labels;
    screenTimeChart.data.datasets[0].data = screenData;
    screenTimeChart.data.datasets[1].data = goalLine; // Goal reference line
    screenTimeChart.update('active');
}

function updateChartWithAnimation(chart, labels, data) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('active');
}

function updateAnalyticsPeriod() {
    updateCharts();
}

// ============================================
// GSAP MOTION POLISH
// ============================================
function animateEntrance() {
    // Kill any existing animations first
    gsap.killTweensOf('.vision-card, .week-card, .daily-card, .analytics-card');
    
    // Set initial state
    gsap.set('.vision-card, .week-card, .daily-card, .analytics-card', {
        opacity: 0,
        y: 20
    });
    
    // Staggered entrance for year vision cards
    gsap.to('.vision-card', {
        duration: 0.6,
        y: 0,
        opacity: 1,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.2
    });
    
    // Week cards
    gsap.to('.week-card', {
        duration: 0.6,
        y: 0,
        opacity: 1,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.4
    });
    
    // Daily cards
    gsap.to('.daily-card', {
        duration: 0.6,
        y: 0,
        opacity: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.6
    });
    
    // Analytics cards
    gsap.to('.analytics-card', {
        duration: 0.6,
        y: 0,
        opacity: 1,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.8
    });
    
    // Header animation
    gsap.fromTo('.header-title', 
        { y: -15, opacity: 0 },
        { duration: 0.8, y: 0, opacity: 1, ease: "power2.out" }
    );
    
    // Section headers slide in
    gsap.fromTo('.section-header', 
        { x: -15, opacity: 0 },
        {
            duration: 0.5,
            x: 0,
            opacity: 1,
            stagger: 0.15,
            ease: "power2.out",
            delay: 0.3
        }
    );
    
    // Score ring draw animation
    const circle = document.querySelector('.score-ring-progress');
    if (circle) {
        const circumference = 2 * Math.PI * 54;
        gsap.fromTo(circle, 
            { strokeDashoffset: circumference },
            { 
                strokeDashoffset: circumference - (dashboardData.year.lifeScore / 100) * circumference,
                duration: 1.5,
                delay: 0.8,
                ease: "power2.out"
            }
        );
    }
}

// Hover micro-interactions
function initHoverAnimations() {
    // Card hover effects
    document.querySelectorAll('.vision-card, .week-card, .daily-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            gsap.to(card, {
                duration: 0.25,
                y: -4,
                boxShadow: '0 12px 24px -6px rgba(0, 0, 0, 0.15)',
                ease: 'power2.out'
            });
        });
        
        card.addEventListener('mouseleave', () => {
            gsap.to(card, {
                duration: 0.25,
                y: 0,
                boxShadow: '',
                ease: 'power2.out',
                clearProps: 'boxShadow'
            });
        });
    });
    
    // Button hover
    document.querySelectorAll('.add-project-btn, .add-task-btn, .btn-primary').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            gsap.to(btn, { duration: 0.2, scale: 1.02, ease: 'power2.out' });
        });
        btn.addEventListener('mouseleave', () => {
            gsap.to(btn, { duration: 0.2, scale: 1, ease: 'power2.out' });
        });
    });
}

// Progress bar animation helper
function animateProgressBar(element, targetWidth, duration = 0.8) {
    gsap.to(element, {
        width: targetWidth,
        duration: duration,
        ease: 'power2.out'
    });
}

// Streak fire animation
function animateStreakFire(element) {
    gsap.to(element, {
        duration: 0.3,
        scale: 1.2,
        color: '#ff6b35',
        repeat: 1,
        yoyo: true,
        ease: 'power2.inOut'
    });
}

// Call hover animations after DOM loaded
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initHoverAnimations, 1000);
    initViewToggle();
    initHistoryView();
});

// ============================================
// VIEW TOGGLE SYSTEM
// ============================================
function initViewToggle() {
    const viewBtns = document.querySelectorAll('.view-btn');
    
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.dataset.view;
            switchView(targetView);
        });
    });
}

function switchView(viewName) {
    // Update buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    
    // Update panels
    document.querySelectorAll('.view-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    const targetPanel = document.getElementById(`${viewName}-view`);
    if (targetPanel) {
        targetPanel.classList.add('active');
        
        // Animate entrance
        gsap.fromTo(targetPanel, 
            { opacity: 0, y: 15 },
            { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
        );
        
        // If switching to history, update it
        if (viewName === 'history') {
            updateHistoryView();
        }
    }
}

// ============================================
// HISTORY VIEW
// ============================================
let currentCalendarMonth = new Date();

function initHistoryView() {
    // Timeline filter
    const timelineFilter = document.getElementById('timeline-filter');
    if (timelineFilter) {
        timelineFilter.addEventListener('change', updateTimeline);
    }
    
    // Calendar navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
        renderCalendar();
    });
    
    document.getElementById('next-month')?.addEventListener('click', () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
        renderCalendar();
    });
}

function updateHistoryView() {
    updateHistoryHeader();
    updateHistoryStats();
    updateMonthSummaries();
    renderCalendar();
    updateTimeline();
    updateRulesChecklist();
    updateTrends();
    initTimelineFilters();
}

// ============================================
// HISTORY HEADER STATS (v11 - Truthful)
// ============================================
function updateHistoryHeader() {
    const allLogs = dashboardData.dailyLogs;
    const score = dashboardData.year.lifeScore;
    
    // v11: Only count FINALIZED days (exclude NOT_COUNTED)
    const finalizedLogs = allLogs.filter(log => log.finalized);
    
    // Total days tracked (only finalized)
    const totalDaysEl = document.getElementById('total-days-tracked');
    if (totalDaysEl) {
        gsap.to({ val: 0 }, {
            val: finalizedLogs.length,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                totalDaysEl.textContent = Math.round(this.targets()[0].val);
            }
        });
    }
    
    // Best streak ever
    const bestStreak = Math.max(
        dashboardData.streakHistory.learning?.best || dashboardData.streaks.learning || 0,
        dashboardData.streakHistory.gym?.best || dashboardData.streaks.gym || 0,
        dashboardData.streakHistory.sleep?.best || dashboardData.streaks.sleep || 0
    );
    const bestStreakEl = document.getElementById('best-streak-ever');
    if (bestStreakEl) {
        gsap.to({ val: 0 }, {
            val: bestStreak,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                bestStreakEl.textContent = Math.round(this.targets()[0].val);
            }
        });
    }
    
    // Average day score - v11: Only include FINALIZED days
    const avgScore = finalizedLogs.length > 0 
        ? Math.round(finalizedLogs.reduce((sum, log) => sum + calculateDayScore(log), 0) / finalizedLogs.length)
        : 0;
    const avgScoreEl = document.getElementById('avg-day-score');
    if (avgScoreEl) {
        gsap.to({ val: 0 }, {
            val: avgScore,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                avgScoreEl.textContent = Math.round(this.targets()[0].val);
            }
        });
    }
    
    // Life score
    const lifeScoreEl = document.getElementById('history-life-score');
    if (lifeScoreEl) {
        gsap.to({ val: 0 }, {
            val: score,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                lifeScoreEl.textContent = Math.round(this.targets()[0].val);
            }
        });
    }
}

// ============================================
// HISTORY STATISTICS (v11 - Exclude NOT_COUNTED)
// ============================================
function updateHistoryStats() {
    const periodSelect = document.getElementById('stats-period');
    const days = parseInt(periodSelect?.value || 30);
    const allLogs = getLogsForPeriod(days);
    
    // v11: Only include FINALIZED logs in statistics; if none, fall back to all logs so UI isn't empty
    let logs = allLogs.filter(log => log.finalized);
    if (logs.length === 0) logs = allLogs;
    
    // Calculate stats
    const totalLearningHours = logs.reduce((sum, l) => sum + (l.learningHours || 0), 0);
    const gymSessions = logs.filter(l => l.workout).length;
    const earlyWakeups = logs.filter(l => wasWakeupOnTime(l)).length;
    const avgScreenTime = logs.length > 0 
        ? (logs.reduce((sum, l) => sum + (l.screenTime || 0), 0) / logs.length).toFixed(1)
        : 0;
    
    // Update stat values
    const learningHoursEl = document.getElementById('stat-learning-hours');
    if (learningHoursEl) learningHoursEl.textContent = Math.round(totalLearningHours) + 'h';
    
    const gymSessionsEl = document.getElementById('stat-gym-sessions');
    if (gymSessionsEl) gymSessionsEl.textContent = gymSessions;
    
    const earlyWakeupsEl = document.getElementById('stat-early-wakeups');
    if (earlyWakeupsEl) earlyWakeupsEl.textContent = earlyWakeups;
    
    const avgScreenEl = document.getElementById('stat-avg-screen');
    if (avgScreenEl) avgScreenEl.textContent = avgScreenTime + 'h';
    
    // Calculate and animate consistencies (only from finalized days)
    const learningConsistency = calculateConsistency(logs, 'learningDone');
    const gymConsistency = calculateGymConsistency(logs);
    const sleepConsistency = calculateSleepConsistency(logs);
    const screenConsistency = calculateScreenConsistency(logs);
    
    animateStatBar('learning', learningConsistency);
    animateStatBar('gym', gymConsistency);
    animateStatBar('sleep', sleepConsistency);
    animateStatBar('screen', screenConsistency);
    
    // Update log count
    const logCountEl = document.getElementById('log-count');
    if (logCountEl) {
        const timelineDays = parseInt(document.getElementById('timeline-filter')?.value || 7);
        const timelineLogs = getLogsForPeriod(timelineDays);
        logCountEl.textContent = `${timelineLogs.length} entries`;
    }
}

function animateStatBar(type, value) {
    const barEl = document.getElementById(`${type}-bar`);
    const percentEl = document.getElementById(`${type}-consistency`);
    
    if (barEl) {
        gsap.to(barEl, {
            width: `${value}%`,
            duration: 1,
            ease: 'power2.out'
        });
    }
    
    if (percentEl) {
        gsap.to({ val: 0 }, {
            val: value,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                percentEl.textContent = Math.round(this.targets()[0].val) + '%';
            }
        });
    }
}

// ============================================
// MONTH SUMMARIES
// ============================================
function updateMonthSummaries() {
    const container = document.getElementById('month-summaries');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group logs by month
    const monthGroups = {};
    dashboardData.dailyLogs.forEach(log => {
        const date = parseDate(log.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthGroups[monthKey]) {
            monthGroups[monthKey] = [];
        }
        monthGroups[monthKey].push(log);
    });
    
    // Sort months and take last 6
    const sortedMonths = Object.keys(monthGroups).sort().reverse().slice(0, 6).reverse();
    
    sortedMonths.forEach(monthKey => {
        const logs = monthGroups[monthKey];
        const [year, month] = monthKey.split('-');
        const monthName = new Date(year, parseInt(month) - 1).toLocaleDateString('en-US', { 
            month: 'short', 
            year: 'numeric' 
        });
        
        const avgScore = Math.round(
            logs.reduce((sum, log) => sum + calculateDayScore(log), 0) / logs.length
        );
        
        const card = document.createElement('div');
        card.className = 'month-summary-card';
        card.innerHTML = `
            <span class="month-name">${monthName}</span>
            <span class="month-score">${avgScore}</span>
            <span class="month-days">${logs.length} days</span>
        `;
        container.appendChild(card);
    });
}

// ============================================
// TIMELINE FILTERS
// ============================================
function initTimelineFilters() {
    // Period filter
    const periodSelect = document.getElementById('stats-period');
    if (periodSelect) {
        periodSelect.removeEventListener('change', updateHistoryStats);
        periodSelect.addEventListener('change', updateHistoryStats);
    }
    
    // Filter chips
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            updateTimeline(chip.dataset.filter);
        });
    });
}

function calculateConsistency(logs, field) {
    if (logs.length === 0) return 0;
    const done = logs.filter(l => l[field]).length;
    return Math.round((done / logs.length) * 100);
}

function calculateGymConsistency(logs) {
    if (logs.length === 0) return 0;
    // Target: 5 workouts per 7 days
    const weeks = Math.ceil(logs.length / 7);
    const workouts = logs.filter(l => l.workout).length;
    const target = weeks * 5;
    return Math.min(Math.round((workouts / target) * 100), 100);
}

function calculateSleepConsistency(logs) {
    if (logs.length === 0) return 0;
    const onTime = logs.filter(l => {
        if (!l.wakeUp) return false;
        const wakeup = new Date(`2000-01-01T${l.wakeUp}`);
        const target = new Date(`2000-01-01T${dashboardData.settings.wakeupTarget}`);
        return (wakeup - target) / 60000 <= 30;
    }).length;
    return Math.round((onTime / logs.length) * 100);
}

function calculateScreenConsistency(logs) {
    if (logs.length === 0) return 0;
    const underGoal = logs.filter(l => l.screenTime <= dashboardData.settings.screenTimeGoal).length;
    return Math.round((underGoal / logs.length) * 100);
}

function animateConsistency(type, value) {
    const valueEl = document.getElementById(`${type}-consistency`);
    const barEl = document.getElementById(`${type}-bar`);
    
    if (valueEl) {
        gsap.to({ val: 0 }, {
            val: value,
            duration: 1,
            ease: 'power2.out',
            onUpdate: function() {
                valueEl.textContent = Math.round(this.targets()[0].val) + '%';
            }
        });
    }
    
    if (barEl) {
        gsap.to(barEl, {
            width: `${value}%`,
            duration: 1,
            ease: 'power2.out'
        });
    }
}

function getLogsForPeriod(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return dashboardData.dailyLogs.filter(log => {
        const logDate = parseDate(log.date);
        return logDate >= cutoff;
    });
}

// ============================================
// CALENDAR HEATMAP
// ============================================
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    
    // Update month label
    const monthLabel = document.getElementById('calendar-month');
    if (monthLabel) {
        monthLabel.textContent = new Date(year, month).toLocaleDateString('en-US', { 
            month: 'long', 
            year: 'numeric' 
        });
    }
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    
    // Get first day of week (0 = Sunday, adjust for Monday start)
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;
    
    // Add empty cells for days before first of month
    for (let i = 0; i < startDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        grid.appendChild(emptyCell);
    }
    
    // Add days of month
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateStr = getDateString(date);
        const log = dashboardData.dailyLogs.find(l => l.date === dateStr);
        
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.textContent = day;
        
        // Check if today
        if (date.toDateString() === today.toDateString()) {
            dayCell.classList.add('today');
        }
        
        // Only color past days
        if (date <= today) {
            const level = calculateDayLevel(log);
            dayCell.classList.add(`level-${level}`);
            
            // Add tooltip
            if (log) {
                dayCell.dataset.tooltip = getDayTooltip(log);
            }
        }
        
        grid.appendChild(dayCell);
    }
}

function calculateDayLevel(log) {
    if (!log) return 0;
    
    let score = 0;
    if (log.learningDone) score += 25;
    if (log.workout) score += 25;
    if (log.screenTime <= dashboardData.settings.screenTimeGoal) score += 25;
    if (log.mitsDone?.filter(Boolean).length >= 2) score += 25;
    
    if (score >= 90) return 4;
    if (score >= 65) return 3;
    if (score >= 40) return 2;
    if (score > 0) return 1;
    return 0;
}

function getDayTooltip(log) {
    const parts = [];
    if (log.learningDone) parts.push('📚');
    if (log.workout) parts.push('💪');
    if (log.mood) parts.push('🎭' + log.mood);
    if (log.screenTime) parts.push('📱' + log.screenTime + 'h');
    return parts.join(' ') || 'No data';
}

// ============================================
// DAILY TIMELINE
// ============================================
function updateTimeline(filter = 'all') {
    const container = document.getElementById('timeline-container');
    const emptyState = document.getElementById('timeline-empty');
    if (!container) return;
    
    const days = parseInt(document.getElementById('timeline-filter')?.value || 7);
    let logs = getLogsForPeriod(days).sort((a, b) => 
        parseDate(b.date) - parseDate(a.date)
    );
    
    // Apply filter
    if (filter === 'good') {
        logs = logs.filter(log => calculateDayScore(log) >= 60);
    } else if (filter === 'bad') {
        logs = logs.filter(log => calculateDayScore(log) < 60);
    }
    
    // Clear existing items (keep empty state)
    container.querySelectorAll('.timeline-item').forEach(el => el.remove());
    
    // Update log count
    const logCountEl = document.getElementById('log-count');
    if (logCountEl) {
        logCountEl.textContent = `${logs.length} entries`;
    }
    
    if (logs.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    logs.forEach((log, index) => {
        const item = createTimelineItem(log);
        container.appendChild(item);
        
        // Animate entrance
        gsap.fromTo(item, 
            { opacity: 0, x: -20 },
            { opacity: 1, x: 0, duration: 0.4, delay: index * 0.03, ease: 'power2.out' }
        );
    });
}

function createTimelineItem(log) {
    const date = parseDate(log.date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    let dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    if (date.toDateString() === today.toDateString()) dayName = 'Today';
    else if (date.toDateString() === yesterday.toDateString()) dayName = 'Yesterday';
    
    const dayScore = calculateDayScore(log);
    const mitsCompleted = log.mitsDone?.filter(Boolean).length || 0;
    const totalMits = log.mitsText?.filter(t => t && t.trim()).length || (log.mits?.filter(t => t && t.trim()).length) || 3;
    
    // Get day state - show NOT_COUNTED if not finalized
    let dayState, stateInfo;
    if (!log.finalized) {
        dayState = DAY_STATES.NOT_COUNTED;
        stateInfo = DAY_STATE_INFO.NOT_COUNTED;
    } else {
        dayState = calculateDayState(log);
        stateInfo = DAY_STATE_INFO[dayState] || DAY_STATE_INFO.NOT_COUNTED;
    }
    
    // Determine MIT quality indicator
    let mitQuality = '';
    if (log.finalized && mitsCompleted === totalMits && totalMits > 0) {
        mitQuality = 'high-quality';
    } else if (log.finalized && mitsCompleted >= Math.ceil(totalMits / 2)) {
        mitQuality = 'medium-quality';
    }
    
    // Determine score class
    let scoreClass = 'score-low';
    if (dayScore >= 70) scoreClass = 'score-high';
    else if (dayScore >= 50) scoreClass = 'score-medium';
    
    const item = document.createElement('div');
    item.className = `timeline-item ${scoreClass} ${!log.finalized ? 'not-finalized' : ''}`;
    item.innerHTML = `
        <div class="timeline-header">
            <div class="timeline-date">
                <span class="day-name">${dayName}</span>
                <span class="date-full">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
            <div class="timeline-state-badge ${stateInfo.cssClass}" title="${stateInfo.description}">
                <span class="state-icon">${stateInfo.icon}</span>
                <span class="state-label">${stateInfo.label}</span>
            </div>
            <div class="timeline-icons">
                <div class="timeline-icon ${log.learningDone ? 'done' : 'missed'}" title="Learning">
                    <i class="fas fa-book"></i>
                </div>
                <div class="timeline-icon ${log.workout ? 'done' : 'missed'}" title="Gym">
                    <i class="fas fa-dumbbell"></i>
                </div>
                <div class="timeline-icon ${wasWakeupOnTime(log) ? 'done' : 'missed'}" title="Sleep">
                    <i class="fas fa-moon"></i>
                </div>
                <div class="mood-dot mood-${log.mood || 0}" title="Mood: ${log.mood || 'N/A'}"></div>
                <span class="timeline-meta">📱${log.screenTime || 0}h</span>
                <span class="timeline-meta ${mitQuality}">✓${mitsCompleted}/${totalMits}</span>
            </div>
            <div class="timeline-score ${scoreClass}">
                <span class="score-num">${dayScore}</span>
                <span class="score-label">score</span>
            </div>
        </div>
        <div class="timeline-details">
            <div class="detail-grid">
                ${log.learned ? `<div class="detail-item"><i class="fas fa-book"></i> ${log.learned}</div>` : ''}
                ${log.learningHours ? `<div class="detail-item"><i class="fas fa-clock"></i> ${log.learningHours}h learning</div>` : ''}
                ${log.workoutType && log.workout ? `<div class="detail-item"><i class="fas fa-dumbbell"></i> ${log.workoutType}</div>` : ''}
                ${log.wakeUp ? `<div class="detail-item"><i class="fas fa-sun"></i> Woke at ${log.wakeUp}</div>` : ''}
                ${!log.finalized ? `<div class="detail-item neutral-detail"><i class="fas fa-pause"></i> Day not finalized (neutral) - Streak paused</div>` : ''}
                ${log.finalized && dayState === DAY_STATES.MISSED ? `<div class="detail-item missed-detail"><i class="fas fa-times"></i> Requirements not met - Streak broken</div>` : ''}
                ${log.finalized && dayState === DAY_STATES.COMPLETED ? `<div class="detail-item success-detail"><i class="fas fa-check"></i> All requirements met - Streak counts</div>` : ''}
                ${log.screenTime > 5 ? `<div class="detail-item missed-detail"><i class="fas fa-mobile-alt"></i> High screen time</div>` : ''}
            </div>
        </div>
    `;
    
    // Toggle expand on click
    item.addEventListener('click', () => {
        item.classList.toggle('expanded');
    });
    
    return item;
}

function calculateDayScore(log) {
    let score = 0;
    if (log.learningDone) score += 30;
    if (log.workout) score += 20;
    if (wasWakeupOnTime(log)) score += 20;
    if (log.screenTime <= dashboardData.settings.screenTimeGoal) score += 15;
    const mits = log.mitsDone?.filter(Boolean).length || 0;
    score += mits * 5;
    return Math.min(score, 100);
}

// ============================================
// RULES CHECKLIST
// ============================================
function updateRulesChecklist() {
    // v11: Only use FINALIZED days for discipline rules
    const allLast7Days = getLogsForPeriod(7);
    const last7Days = allLast7Days.filter(l => l.finalized);
    const allLast30Days = getLogsForPeriod(30);
    const last30Days = allLast30Days.filter(l => l.finalized);
    
    // If no finalized days, show all as not passed
    if (last7Days.length === 0) {
        updateRuleCheck('learn-daily', false);
        updateRuleCheck('learn-hours', false);
        updateRuleCheck('learn-streak', false);
        updateRulesBar('learning', [false, false, false]);
        updateRuleCheck('gym-weekly', false);
        updateRuleCheck('gym-streak', false);
        updateRuleCheck('gym-consistency', false);
        updateRulesBar('gym', [false, false, false]);
        updateRuleCheck('sleep-wakeup', false);
        updateRuleCheck('sleep-bedtime', false);
        updateRuleCheck('sleep-streak', false);
        updateRulesBar('sleep', [false, false, false]);
        updateRuleCheck('screen-limit', false);
        updateRuleCheck('screen-avg', false);
        updateRuleCheck('screen-zero', false);
        updateRulesBar('screen', [false, false, false]);
        updateRulesScore();
        return;
    }
    
    // Learning rules
    const learnDaily = last7Days.length >= 7 && last7Days.every(l => l.learningDone);
    const avgHours = last7Days.reduce((sum, l) => sum + (l.learningHours || 0), 0) / Math.max(last7Days.length, 1);
    const learnStreak = dashboardData.streaks.learning >= 7;
    
    updateRuleCheck('learn-daily', learnDaily);
    updateRuleCheck('learn-hours', avgHours >= 2);
    updateRuleCheck('learn-streak', learnStreak);
    updateRulesBar('learning', [learnDaily, avgHours >= 2, learnStreak]);
    
    // Gym rules
    const gymWeekly = last7Days.filter(l => l.workout).length >= 5;
    const gymStreak = dashboardData.streaks.gym >= 5;
    const gymConsistency = calculateGymConsistency(last7Days) >= 80;
    
    updateRuleCheck('gym-weekly', gymWeekly);
    updateRuleCheck('gym-streak', gymStreak);
    updateRuleCheck('gym-consistency', gymConsistency);
    updateRulesBar('gym', [gymWeekly, gymStreak, gymConsistency]);
    
    // Sleep rules
    const wakeupOnTime = last7Days.filter(l => wasWakeupOnTime(l)).length >= 5;
    const sleepOnTime = last7Days.filter(l => l.sleptOnTime !== false).length >= 5;
    const sleepStreak = dashboardData.streaks.sleep >= 7;
    
    updateRuleCheck('sleep-wakeup', wakeupOnTime);
    updateRuleCheck('sleep-bedtime', sleepOnTime);
    updateRuleCheck('sleep-streak', sleepStreak);
    updateRulesBar('sleep', [wakeupOnTime, sleepOnTime, sleepStreak]);
    
    // Screen rules
    const screenLimit = last7Days.filter(l => l.screenTime <= 3).length >= 5;
    const screenAvg = last7Days.reduce((s, l) => s + (l.screenTime || 0), 0) / Math.max(last7Days.length, 1) <= 2.5;
    const noHighDays = !last7Days.some(l => l.screenTime >= 5);
    
    updateRuleCheck('screen-limit', screenLimit);
    updateRuleCheck('screen-avg', screenAvg);
    updateRuleCheck('screen-zero', noHighDays);
    updateRulesBar('screen', [screenLimit, screenAvg, noHighDays]);
}

function updateRuleCheck(rule, passed) {
    const check = document.querySelector(`[data-rule="${rule}"]`);
    if (check) {
        check.classList.remove('passed', 'failed');
        check.classList.add(passed ? 'passed' : 'failed');
    }
}

function updateRulesBar(category, rules) {
    const bar = document.getElementById(`${category}-rules-bar`);
    if (bar) {
        const passed = rules.filter(Boolean).length;
        const percent = (passed / rules.length) * 100;
        gsap.to(bar, { width: `${percent}%`, duration: 0.8, ease: 'power2.out' });
    }
}

// ============================================
// TRENDS ANALYSIS
// ============================================
function updateTrends() {
    const last7Days = getLogsForPeriod(7);
    const prev7Days = getLogsForPeriod(14).filter(l => !last7Days.includes(l));
    
    // Learning trend
    const learnNow = last7Days.filter(l => l.learningDone).length / Math.max(last7Days.length, 1);
    const learnPrev = prev7Days.filter(l => l.learningDone).length / Math.max(prev7Days.length, 1);
    updateTrendCard('learning', learnNow, learnPrev);
    
    // Gym trend
    const gymNow = last7Days.filter(l => l.workout).length / Math.max(last7Days.length, 1);
    const gymPrev = prev7Days.filter(l => l.workout).length / Math.max(prev7Days.length, 1);
    updateTrendCard('gym', gymNow, gymPrev);
    
    // Sleep trend
    const sleepNow = last7Days.filter(l => wasWakeupOnTime(l)).length / Math.max(last7Days.length, 1);
    const sleepPrev = prev7Days.filter(l => wasWakeupOnTime(l)).length / Math.max(prev7Days.length, 1);
    updateTrendCard('sleep', sleepNow, sleepPrev);
    
    // Screen trend (lower is better)
    const screenNow = last7Days.reduce((s, l) => s + (l.screenTime || 0), 0) / Math.max(last7Days.length, 1);
    const screenPrev = prev7Days.reduce((s, l) => s + (l.screenTime || 0), 0) / Math.max(prev7Days.length, 1);
    updateTrendCard('screen', screenPrev, screenNow); // Reversed for screen (lower = better)
}

function updateTrendCard(type, current, previous) {
    const statusEl = document.getElementById(`${type}-trend-status`);
    const arrowEl = document.getElementById(`${type}-trend-arrow`);
    
    if (!statusEl || !arrowEl) return;
    
    const diff = current - previous;
    const threshold = 0.1;
    
    if (diff > threshold) {
        statusEl.textContent = 'Improving';
        arrowEl.className = 'trend-indicator up';
        arrowEl.innerHTML = '<i class="fas fa-arrow-up"></i>';
    } else if (diff < -threshold) {
        statusEl.textContent = 'Declining';
        arrowEl.className = 'trend-indicator down';
        arrowEl.innerHTML = '<i class="fas fa-arrow-down"></i>';
    } else {
        statusEl.textContent = 'Stable';
        arrowEl.className = 'trend-indicator';
        arrowEl.innerHTML = '<i class="fas fa-minus"></i>';
    }
    
    // Update total rules score
    updateRulesScore();
}

function updateRulesScore() {
    const allChecks = document.querySelectorAll('.rule-check');
    const passed = Array.from(allChecks).filter(c => c.classList.contains('passed')).length;
    const total = allChecks.length;
    const scoreEl = document.getElementById('rules-score');
    if (scoreEl) {
        scoreEl.textContent = `${passed}/${total}`;
    }
}

// ============================================
// AUTO-SAVE & BACKGROUND TASKS
// ============================================

// Auto-save every 30 seconds (more frequent for reliability)
setInterval(() => {
    saveToStorage();
}, 30000);

// Periodic dashboard refresh (every 5 minutes)
setInterval(() => {
    updateDashboard();
}, 300000);