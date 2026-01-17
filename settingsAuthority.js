// ============================================
// SETTINGS AUTHORITY SYSTEM
// Centralized cold settings that control all system behavior
// ============================================

const SettingsAuthority = {
    // Current active settings (loaded from storage)
    current: null,
    
    // Settings history for audit trail
    history: [],
    
    // Default settings template
    defaults: {
        // ===== TIME SETTINGS =====
        dayCutoffTime: '02:00',        // Day closes at 2 AM
        weekStartDay: 1,                // 0=Sunday, 1=Monday
        
        // ===== NON-NEGOTIABLES (Required Minimums) =====
        nonNegotiables: {
            learning: {
                enabled: true,
                minHoursDaily: 2,           // Minimum hours per day
                requiredFields: ['learningHours', 'learned'],  // Required data when toggle ON
            },
            gym: {
                enabled: true,
                minSessionsWeekly: 5,       // Sessions per week
                requiredFields: ['workoutType'],
            },
            sleep: {
                enabled: true,
                wakeupTarget: '05:45',      // Target wake time
                wakeupTolerance: 30,        // Minutes tolerance
                bedtimeTarget: '23:30',     // Target bedtime
                bedtimeTolerance: 30,
            },
            screenTime: {
                enabled: true,
                dailyLimit: 3,              // Hours max
                weeklyAvgLimit: 2.5,
                criticalThreshold: 5,       // Hours - counts as failure
            },
        },
        
        // ===== STREAK SETTINGS =====
        streaks: {
            sensitivity: 'normal',          // 'strict' | 'normal' | 'lenient'
            penaltyMultipliers: {
                strict: { missed: 1.0, partial: 0.7, skipped: 0.5 },
                normal: { missed: 1.0, partial: 0.5, skipped: 0.3 },
                lenient: { missed: 0.8, partial: 0.3, skipped: 0.1 },
            },
            gracePeriodDays: 0,             // Days before streak breaks (strict=0)
        },
        
        // ===== SKIP DAY SETTINGS =====
        skipDays: {
            allowed: true,
            maxPerWeek: 1,
            maxPerMonth: 3,
            penaltyPercent: 20,             // Life score penalty
            requiresReason: true,
        },
        
        // ===== SCORING WEIGHTS =====
        scoring: {
            weights: {
                learning: 30,
                gym: 25,
                sleep: 25,
                screenTime: 10,
                mits: 10,
            },
            consistencyMultiplier: 1.5,     // Bonus for consistency
            unreliabilityPenalty: 2.0,      // Penalty multiplier for missed days
        },
        
        // ===== DAY VALIDATION RULES =====
        validation: {
            requireAllNonNegotiables: true,
            allowPartialDays: true,
            partialDayThreshold: 0.5,       // 50% completion = partial
        },
    },
    
    // Initialize settings from storage
    async init() {
        try {
            // Try to load from backend first
            if (typeof API !== 'undefined' && await API.isAvailable()) {
                const response = await API.getSettings();
                if (response && response.settings) {
                    this.current = this.mergeWithDefaults(response.settings);
                    this.history = response.history || [];
                    console.log('[SettingsAuthority] Loaded from backend');
                    return;
                }
            }
        } catch (e) {
            console.warn('[SettingsAuthority] Backend load failed:', e);
        }
        
        // Fall back to localStorage
        const stored = localStorage.getItem('ai-tracker-settings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                this.current = this.mergeWithDefaults(parsed.settings || parsed);
                this.history = parsed.history || [];
                console.log('[SettingsAuthority] Loaded from localStorage');
            } catch (e) {
                console.warn('[SettingsAuthority] Parse error, using defaults');
                this.current = { ...this.defaults };
            }
        } else {
            this.current = { ...this.defaults };
            console.log('[SettingsAuthority] Using default settings');
        }
    },
    
    // Merge stored settings with defaults (handles missing keys)
    mergeWithDefaults(stored) {
        const merged = JSON.parse(JSON.stringify(this.defaults));
        
        function deepMerge(target, source) {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key]) target[key] = {};
                    deepMerge(target[key], source[key]);
                } else if (source[key] !== undefined) {
                    target[key] = source[key];
                }
            }
            return target;
        }
        
        return deepMerge(merged, stored);
    },
    
    // Get a setting value by path (e.g., 'nonNegotiables.learning.minHoursDaily')
    get(path) {
        if (!this.current) return null;
        
        const keys = path.split('.');
        let value = this.current;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return null;
            }
        }
        
        return value;
    },
    
    // Update a setting (cold update - only affects future)
    async set(path, value, reason = '') {
        if (!this.current) await this.init();
        
        const keys = path.split('.');
        let target = this.current;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in target)) target[keys[i]] = {};
            target = target[keys[i]];
        }
        
        const oldValue = target[keys[keys.length - 1]];
        target[keys[keys.length - 1]] = value;
        
        // Record change in history
        const change = {
            timestamp: new Date().toISOString(),
            path: path,
            oldValue: oldValue,
            newValue: value,
            reason: reason,
        };
        
        this.history.push(change);
        
        // Save to storage
        await this.save();
        
        console.log(`[SettingsAuthority] Setting changed: ${path}`, change);
        
        return change;
    },
    
    // Save settings to storage
    async save() {
        const data = {
            settings: this.current,
            history: this.history.slice(-100), // Keep last 100 changes
            lastModified: new Date().toISOString(),
        };
        
        // Save to localStorage
        localStorage.setItem('ai-tracker-settings', JSON.stringify(data));
        
        // Try to save to backend
        try {
            if (typeof API !== 'undefined' && await API.isAvailable()) {
                await API.saveSettings(data);
            }
        } catch (e) {
            console.warn('[SettingsAuthority] Backend save failed:', e);
        }
    },
    
    // Get the effective day cutoff time as Date
    getDayCutoffTime() {
        const cutoff = this.get('dayCutoffTime') || '02:00';
        const [hours, minutes] = cutoff.split(':').map(Number);
        const now = new Date();
        const cutoffDate = new Date(now);
        cutoffDate.setHours(hours, minutes, 0, 0);
        return cutoffDate;
    },
    
    // Check if current time is past day cutoff
    isPastDayCutoff() {
        const now = new Date();
        const cutoff = this.getDayCutoffTime();
        
        // If cutoff is 2 AM, we need special logic
        const cutoffHour = parseInt(this.get('dayCutoffTime')?.split(':')[0] || 2);
        
        if (cutoffHour < 12) {
            // Early morning cutoff (e.g., 2 AM)
            // Between midnight and cutoff = still yesterday
            return now.getHours() >= cutoffHour;
        } else {
            return now >= cutoff;
        }
    },
    
    // Get the logical "today" date string based on cutoff
    getLogicalToday() {
        const now = new Date();
        const cutoffHour = parseInt(this.get('dayCutoffTime')?.split(':')[0] || 2);
        
        // If it's between midnight and cutoff, it's still "yesterday"
        if (now.getHours() < cutoffHour) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return this.formatDate(yesterday);
        }
        
        return this.formatDate(now);
    },
    
    // Format date as YYYY-MM-DD
    formatDate(date) {
        return date.toISOString().split('T')[0];
    },
    
    // Get week start date based on settings
    getWeekStartDate(referenceDate = new Date()) {
        const weekStartDay = this.get('weekStartDay') || 1; // Monday
        const date = new Date(referenceDate);
        const currentDay = date.getDay();
        const diff = (currentDay - weekStartDay + 7) % 7;
        date.setDate(date.getDate() - diff);
        date.setHours(0, 0, 0, 0);
        return date;
    },
    
    // Export all settings for display
    exportSettings() {
        return JSON.parse(JSON.stringify(this.current));
    },
};

// ============================================
// DAY STATE MODEL
// ============================================
// Note: DayState is defined in habitSystem.js which loads first
// We reference window.DayState or use these local fallbacks
const SettingsDayState = window.DayState || {
    COMPLETED: 'COMPLETED',
    PARTIAL: 'PARTIAL',
    MISSED: 'MISSED',
    SKIPPED: 'SKIPPED',
    UNDECIDED: 'UNDECIDED',
    IN_PROGRESS: 'IN_PROGRESS'
};

const DayStateManager = {
    // Determine the state of a day based on its log data
    calculateState(log, settings = null) {
        if (!settings) settings = SettingsAuthority.current;
        if (!settings) return SettingsDayState.MISSED;
        
        // No log = missed day
        if (!log) return SettingsDayState.MISSED;
        
        // Check if explicitly skipped
        if (log.skipped === true) return SettingsDayState.SKIPPED;
        
        // Check if day is still open (use IN_PROGRESS)
        if (log.state === SettingsDayState.IN_PROGRESS) return SettingsDayState.IN_PROGRESS;
        
        // If locked state exists, return it
        if (log.lockedState) return log.lockedState;
        
        // Calculate completion percentage
        const completion = this.calculateCompletion(log, settings);
        
        if (completion >= 1.0) {
            return SettingsDayState.COMPLETED;
        } else if (completion >= (settings.validation?.partialDayThreshold || 0.5)) {
            return SettingsDayState.PARTIAL;
        } else if (completion > 0) {
            return SettingsDayState.PARTIAL;
        } else {
            return SettingsDayState.MISSED;
        }
    },
    
    // Calculate completion percentage for a day
    calculateCompletion(log, settings) {
        if (!log) return 0;
        if (!settings) settings = SettingsAuthority.current;
        
        const checks = [];
        const nn = settings.nonNegotiables;
        
        // Learning check
        if (nn.learning.enabled) {
            const learningValid = this.validateToggle('learning', log);
            checks.push(learningValid ? 1 : 0);
        }
        
        // Gym check (weighted differently - not required every day)
        if (nn.gym.enabled) {
            const gymValid = this.validateToggle('gym', log);
            checks.push(gymValid ? 1 : 0);
        }
        
        // Sleep check
        if (nn.sleep.enabled) {
            const sleepValid = this.validateSleep(log, settings);
            checks.push(sleepValid ? 1 : 0);
        }
        
        // Screen time check
        if (nn.screenTime.enabled) {
            const screenValid = (log.screenTime || 0) <= nn.screenTime.dailyLimit;
            checks.push(screenValid ? 1 : 0);
        }
        
        // MITs check
        const mitsCompleted = (log.mitsDone || []).filter(Boolean).length;
        checks.push(mitsCompleted >= 2 ? 1 : mitsCompleted / 3);
        
        // Calculate average completion
        if (checks.length === 0) return 0;
        return checks.reduce((a, b) => a + b, 0) / checks.length;
    },
    
    // Validate a toggle has required data
    validateToggle(type, log) {
        const settings = SettingsAuthority.current;
        if (!settings) return false;
        
        switch (type) {
            case 'learning':
                if (!log.learningDone) return false;
                // Check required fields
                const minHours = settings.nonNegotiables.learning.minHoursDaily;
                if ((log.learningHours || 0) < minHours) return false;
                if (!log.learned || log.learned.trim() === '') return false;
                return true;
                
            case 'gym':
                if (!log.workout) return false;
                // Workout type is required when toggle is ON
                if (!log.workoutType || log.workoutType.trim() === '') return false;
                return true;
                
            default:
                return false;
        }
    },
    
    // Validate sleep metrics
    validateSleep(log, settings) {
        if (!settings) settings = SettingsAuthority.current;
        const sleepSettings = settings.nonNegotiables.sleep;
        
        if (!log.wakeUp) return false;
        
        // Check wakeup time
        const wakeupTime = this.parseTime(log.wakeUp);
        const targetTime = this.parseTime(sleepSettings.wakeupTarget);
        const tolerance = sleepSettings.wakeupTolerance || 30;
        
        const diffMinutes = (wakeupTime - targetTime) / 60000;
        
        return diffMinutes <= tolerance;
    },
    
    // Parse time string to Date
    parseTime(timeStr) {
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(2000, 0, 1, hours, minutes, 0);
        return date;
    },
    
    // Get state color for UI
    getStateColor(state) {
        switch (state) {
            case SettingsDayState.COMPLETED: return '#10b981'; // Green
            case SettingsDayState.PARTIAL: return '#f59e0b';   // Orange
            case SettingsDayState.MISSED: return '#ef4444';    // Red
            case SettingsDayState.SKIPPED: return '#6b7280';   // Gray
            case SettingsDayState.IN_PROGRESS: return '#3b82f6';      // Blue
            default: return '#374151';
        }
    },
    
    // Get state label for UI
    getStateLabel(state) {
        switch (state) {
            case SettingsDayState.COMPLETED: return 'Completed';
            case SettingsDayState.PARTIAL: return 'Partial';
            case SettingsDayState.MISSED: return 'Missed';
            case SettingsDayState.SKIPPED: return 'Skipped';
            case SettingsDayState.IN_PROGRESS: return 'In Progress';
            case SettingsDayState.UNDECIDED: return 'Future';
            default: return 'Unknown';
        }
    },
};

// ============================================
// TOGGLE AUTHORITY
// Validates all toggle operations
// ============================================

const ToggleAuthority = {
    // Validate a toggle state change
    validate(toggleType, newState, dayLog, showErrors = true) {
        const settings = SettingsAuthority.current;
        if (!settings) {
            return { valid: false, error: 'Settings not initialized' };
        }
        
        // Check if day is locked
        if (dayLog.locked) {
            return { valid: false, error: 'Day is locked and cannot be modified' };
        }
        
        // If turning OFF, always allowed (counts as not done)
        if (!newState) {
            return { valid: true, warning: 'This will count as not completed for today' };
        }
        
        // If turning ON, validate required fields
        switch (toggleType) {
            case 'learning':
                return this.validateLearningToggle(dayLog);
            case 'gym':
                return this.validateGymToggle(dayLog);
            default:
                return { valid: true };
        }
    },
    
    validateLearningToggle(dayLog) {
        const errors = [];
        const settings = SettingsAuthority.current;
        const minHours = settings.nonNegotiables.learning.minHoursDaily;
        
        // Check learning hours
        if (!dayLog.learningHours || dayLog.learningHours < minHours) {
            errors.push(`Minimum ${minHours} hours of learning required`);
        }
        
        // Check what was learned
        if (!dayLog.learned || dayLog.learned.trim() === '') {
            errors.push('Must specify what you learned');
        }
        
        if (errors.length > 0) {
            return { valid: false, errors: errors };
        }
        
        return { valid: true };
    },
    
    validateGymToggle(dayLog) {
        const errors = [];
        
        // Check workout type
        if (!dayLog.workoutType || dayLog.workoutType.trim() === '') {
            errors.push('Must specify workout type');
        }
        
        if (errors.length > 0) {
            return { valid: false, errors: errors };
        }
        
        return { valid: true };
    },
    
    // Show validation error to user
    showValidationError(result) {
        if (result.errors && result.errors.length > 0) {
            alert('Cannot enable toggle:\n\n• ' + result.errors.join('\n• '));
        } else if (result.error) {
            alert(result.error);
        }
    },
};

// ============================================
// DAY LOCK AUTHORITY
// Handles day closing and locking
// ============================================

const DayLockAuthority = {
    // Check and close days that are past cutoff
    async checkAndCloseDays(dashboardData) {
        const today = SettingsAuthority.getLogicalToday();
        const logs = dashboardData.dailyLogs || [];
        
        let closedCount = 0;
        
        for (const log of logs) {
            if (log.locked) continue;  // Already locked
            if (log.date === today) continue;  // Don't lock today
            
            // Lock the day
            await this.lockDay(log, dashboardData);
            closedCount++;
        }
        
        // Check for missed days (gaps in logs)
        await this.fillMissedDays(dashboardData);
        
        if (closedCount > 0) {
            console.log(`[DayLockAuthority] Closed ${closedCount} days`);
        }
        
        return closedCount;
    },
    
    // Lock a specific day
    async lockDay(log, dashboardData) {
        // Calculate final state
        const finalState = DayStateManager.calculateState(log);
        
        // Lock the log
        log.locked = true;
        log.lockedAt = new Date().toISOString();
        log.lockedState = finalState;
        log.state = finalState;
        
        // Calculate final day score
        log.finalScore = this.calculateFinalDayScore(log);
        
        console.log(`[DayLockAuthority] Locked day ${log.date} with state: ${finalState}`);
        
        return log;
    },
    
    // Fill in missed days with empty locked entries
    async fillMissedDays(dashboardData) {
        const logs = dashboardData.dailyLogs || [];
        const today = SettingsAuthority.getLogicalToday();
        
        // Find earliest log date or go back 30 days
        let startDate;
        if (logs.length > 0) {
            const dates = logs.map(l => new Date(l.date)).sort((a, b) => a - b);
            startDate = dates[0];
        } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }
        
        const todayDate = new Date(today);
        const existingDates = new Set(logs.map(l => l.date));
        
        // Iterate through each day
        const current = new Date(startDate);
        while (current < todayDate) {
            const dateStr = SettingsAuthority.formatDate(current);
            
            if (!existingDates.has(dateStr)) {
                // Create a missed day entry
                const missedLog = {
                    date: dateStr,
                    locked: true,
                    lockedAt: new Date().toISOString(),
                    lockedState: SettingsDayState.MISSED,
                    state: SettingsDayState.MISSED,
                    finalScore: 0,
                    learningDone: false,
                    learningHours: 0,
                    learned: '',
                    workout: false,
                    workoutType: '',
                    mood: 0,
                    screenTime: 0,
                    mitsDone: [false, false, false],
                    mitsText: ['', '', ''],
                };
                
                dashboardData.dailyLogs.push(missedLog);
                console.log(`[DayLockAuthority] Created missed day entry for ${dateStr}`);
            }
            
            current.setDate(current.getDate() + 1);
        }
        
        // Sort logs by date
        dashboardData.dailyLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
    },
    
    // Calculate final score for a locked day
    calculateFinalDayScore(log) {
        const state = log.lockedState || log.state;
        const settings = SettingsAuthority.current;
        
        if (state === SettingsDayState.MISSED) return 0;
        if (state === SettingsDayState.SKIPPED) {
            return 100 - (settings.skipDays?.penaltyPercent || 20);
        }
        
        // Calculate based on completion
        const weights = settings.scoring.weights;
        let score = 0;
        let maxScore = 0;
        
        // Learning
        if (settings.nonNegotiables.learning.enabled) {
            maxScore += weights.learning;
            if (DayStateManager.validateToggle('learning', log)) {
                score += weights.learning;
            }
        }
        
        // Gym
        if (settings.nonNegotiables.gym.enabled) {
            maxScore += weights.gym;
            if (DayStateManager.validateToggle('gym', log)) {
                score += weights.gym;
            }
        }
        
        // Sleep
        if (settings.nonNegotiables.sleep.enabled) {
            maxScore += weights.sleep;
            if (DayStateManager.validateSleep(log, settings)) {
                score += weights.sleep;
            }
        }
        
        // Screen time
        if (settings.nonNegotiables.screenTime.enabled) {
            maxScore += weights.screenTime;
            const limit = settings.nonNegotiables.screenTime.dailyLimit;
            if ((log.screenTime || 0) <= limit) {
                score += weights.screenTime;
            }
        }
        
        // MITs
        maxScore += weights.mits;
        const mitsCompleted = (log.mitsDone || []).filter(Boolean).length;
        score += (mitsCompleted / 3) * weights.mits;
        
        return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    },
    
    // Check if a day can be modified
    canModify(log) {
        if (!log) return true;  // New day
        if (log.locked) return false;
        
        const today = SettingsAuthority.getLogicalToday();
        return log.date === today;
    },
};

// ============================================
// SKIP DAY AUTHORITY
// Handles manual skip day requests
// ============================================

const SkipDayAuthority = {
    // Request to skip today
    async requestSkip(reason, dashboardData) {
        const settings = SettingsAuthority.current;
        
        // Check if skip days are allowed
        if (!settings.skipDays.allowed) {
            return { allowed: false, error: 'Skip days are not allowed in current settings' };
        }
        
        // Check weekly limit
        const weekSkips = this.getWeekSkipCount(dashboardData);
        if (weekSkips >= settings.skipDays.maxPerWeek) {
            return { 
                allowed: false, 
                error: `Maximum ${settings.skipDays.maxPerWeek} skip days per week reached` 
            };
        }
        
        // Check monthly limit
        const monthSkips = this.getMonthSkipCount(dashboardData);
        if (monthSkips >= settings.skipDays.maxPerMonth) {
            return { 
                allowed: false, 
                error: `Maximum ${settings.skipDays.maxPerMonth} skip days per month reached` 
            };
        }
        
        // Check if reason is required
        if (settings.skipDays.requiresReason && (!reason || reason.trim() === '')) {
            return { allowed: false, error: 'A reason is required to skip a day' };
        }
        
        return { 
            allowed: true, 
            penalty: settings.skipDays.penaltyPercent,
            weekRemaining: settings.skipDays.maxPerWeek - weekSkips - 1,
            monthRemaining: settings.skipDays.maxPerMonth - monthSkips - 1,
        };
    },
    
    // Get skip count for current week
    getWeekSkipCount(dashboardData) {
        const weekStart = SettingsAuthority.getWeekStartDate();
        const logs = dashboardData.dailyLogs || [];
        
        return logs.filter(log => {
            const logDate = new Date(log.date);
            return logDate >= weekStart && log.skipped === true;
        }).length;
    },
    
    // Get skip count for current month
    getMonthSkipCount(dashboardData) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const logs = dashboardData.dailyLogs || [];
        
        return logs.filter(log => {
            const logDate = new Date(log.date);
            return logDate >= monthStart && log.skipped === true;
        }).length;
    },
    
    // Execute skip day
    async executeSkip(reason, dashboardData) {
        const validation = await this.requestSkip(reason, dashboardData);
        if (!validation.allowed) {
            return validation;
        }
        
        const today = SettingsAuthority.getLogicalToday();
        let todayLog = dashboardData.dailyLogs.find(l => l.date === today);
        
        if (!todayLog) {
            todayLog = {
                date: today,
                learningDone: false,
                workout: false,
                mitsDone: [false, false, false],
                mitsText: ['', '', ''],
            };
            dashboardData.dailyLogs.push(todayLog);
        }
        
        todayLog.skipped = true;
        todayLog.skipReason = reason;
        todayLog.skippedAt = new Date().toISOString();
        todayLog.state = SettingsDayState.SKIPPED;
        
        return { 
            success: true, 
            penalty: validation.penalty,
            message: `Day marked as skipped with ${validation.penalty}% penalty` 
        };
    },
};

// ============================================
// STREAK AUTHORITY
// Enforces streak rules based on day states
// ============================================

const StreakAuthority = {
    // Recalculate all streaks based on locked days
    recalculateStreaks(dashboardData) {
        const settings = SettingsAuthority.current;
        const logs = [...(dashboardData.dailyLogs || [])]
            .filter(l => l.locked || l.date === SettingsAuthority.getLogicalToday())
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        
        const streaks = {
            learning: this.calculateStreak(logs, 'learning'),
            gym: this.calculateGymStreak(logs),
            sleep: this.calculateStreak(logs, 'sleep'),
        };
        
        dashboardData.streaks = streaks;
        
        return streaks;
    },
    
    // Calculate streak for a specific category
    calculateStreak(logs, category) {
        if (logs.length === 0) return 0;
        
        let streak = 0;
        const settings = SettingsAuthority.current;
        const sensitivity = settings.streaks.sensitivity;
        
        for (const log of logs) {
            const state = log.lockedState || DayStateManager.calculateState(log);
            
            // Determine if this day counts for streak
            let counts = false;
            
            switch (category) {
                case 'learning':
                    counts = DayStateManager.validateToggle('learning', log);
                    break;
                case 'sleep':
                    counts = DayStateManager.validateSleep(log, settings);
                    break;
            }
            
            if (counts) {
                streak++;
            } else {
                // Check if streak breaks based on state
                if (state === SettingsDayState.MISSED) {
                    break;  // Streak always breaks on missed
                } else if (state === SettingsDayState.SKIPPED && sensitivity === 'strict') {
                    break;  // Strict mode: skipped breaks streak
                } else if (state === SettingsDayState.PARTIAL && sensitivity === 'strict') {
                    break;  // Strict mode: partial breaks streak
                } else if (state === SettingsDayState.SKIPPED || state === SettingsDayState.PARTIAL) {
                    // Normal/lenient: skipped/partial doesn't break but doesn't add
                    continue;
                } else {
                    break;  // Default: break streak
                }
            }
        }
        
        return streak;
    },
    
    // Calculate gym streak (different logic - not daily)
    calculateGymStreak(logs) {
        if (logs.length === 0) return 0;
        
        // Gym streak counts consecutive workout days only
        let streak = 0;
        let lastWorkoutDate = null;
        
        for (const log of logs) {
            if (DayStateManager.validateToggle('gym', log)) {
                if (lastWorkoutDate === null) {
                    streak = 1;
                    lastWorkoutDate = new Date(log.date);
                } else {
                    const dayDiff = Math.floor((lastWorkoutDate - new Date(log.date)) / (1000 * 60 * 60 * 24));
                    if (dayDiff <= 2) {  // Allow 1 rest day between workouts
                        streak++;
                        lastWorkoutDate = new Date(log.date);
                    } else {
                        break;
                    }
                }
            }
        }
        
        return streak;
    },
    
    // Get streak damage for a state transition
    getStreakDamage(fromState, toState) {
        const settings = SettingsAuthority.current;
        const multipliers = settings.streaks.penaltyMultipliers[settings.streaks.sensitivity];
        
        if (toState === SettingsDayState.MISSED) {
            return multipliers.missed;  // Full break
        } else if (toState === SettingsDayState.PARTIAL) {
            return multipliers.partial;
        } else if (toState === SettingsDayState.SKIPPED) {
            return multipliers.skipped;
        }
        
        return 0;
    },
};

// ============================================
// LIFE SCORE AUTHORITY
// Calculates life score with proper enforcement
// ============================================

const LifeScoreAuthority = {
    // Recalculate life score based on all data
    recalculate(dashboardData) {
        const settings = SettingsAuthority.current;
        const logs = (dashboardData.dailyLogs || []).filter(l => l.locked);
        
        if (logs.length === 0) return 50;  // Neutral starting score
        
        // Count day states
        const states = {
            completed: logs.filter(l => l.lockedState === SettingsDayState.COMPLETED).length,
            partial: logs.filter(l => l.lockedState === SettingsDayState.PARTIAL).length,
            missed: logs.filter(l => l.lockedState === SettingsDayState.MISSED).length,
            skipped: logs.filter(l => l.lockedState === SettingsDayState.SKIPPED).length,
        };
        
        const total = logs.length;
        if (total === 0) return 50;
        
        // Base score from completion rate
        const weights = {
            completed: 1.0,
            partial: 0.5,
            skipped: 0.3,
            missed: 0,
        };
        
        let baseScore = 0;
        baseScore += states.completed * weights.completed;
        baseScore += states.partial * weights.partial;
        baseScore += states.skipped * weights.skipped;
        baseScore = (baseScore / total) * 100;
        
        // Apply unreliability penalty (missed days hurt more than success helps)
        const unreliabilityPenalty = settings.scoring.unreliabilityPenalty;
        const missedRatio = states.missed / total;
        baseScore -= (missedRatio * unreliabilityPenalty * 30);  // Up to -60 for 100% missed
        
        // Apply consistency bonus
        const consistencyBonus = this.calculateConsistencyBonus(logs);
        baseScore += consistencyBonus;
        
        // Apply streak bonuses
        const streakBonus = this.calculateStreakBonus(dashboardData);
        baseScore += streakBonus;
        
        // Clamp to 0-100
        const finalScore = Math.max(0, Math.min(100, Math.round(baseScore)));
        
        dashboardData.year.lifeScore = finalScore;
        
        return finalScore;
    },
    
    // Calculate bonus for consistent behavior
    calculateConsistencyBonus(logs) {
        if (logs.length < 7) return 0;
        
        const last7 = logs.slice(-7);
        const completed = last7.filter(l => l.lockedState === SettingsDayState.COMPLETED).length;
        
        // Bonus for 7 completed days in a row
        if (completed === 7) return 10;
        if (completed >= 5) return 5;
        
        return 0;
    },
    
    // Calculate bonus from streaks
    calculateStreakBonus(dashboardData) {
        const streaks = dashboardData.streaks || {};
        let bonus = 0;
        
        // Learning streak bonus
        if (streaks.learning >= 30) bonus += 5;
        else if (streaks.learning >= 14) bonus += 3;
        else if (streaks.learning >= 7) bonus += 1;
        
        // Gym streak bonus
        if (streaks.gym >= 20) bonus += 3;
        else if (streaks.gym >= 10) bonus += 2;
        else if (streaks.gym >= 5) bonus += 1;
        
        // Sleep streak bonus
        if (streaks.sleep >= 14) bonus += 3;
        else if (streaks.sleep >= 7) bonus += 1;
        
        return bonus;
    },
};

// ============================================
// WEEKLY STATS AUTHORITY
// Calculates weekly stats using only valid, closed days
// ============================================

const WeeklyStatsAuthority = {
    // Recalculate current week stats
    recalculate(dashboardData) {
        const weekStart = SettingsAuthority.getWeekStartDate();
        const today = new Date(SettingsAuthority.getLogicalToday());
        
        const logs = (dashboardData.dailyLogs || []).filter(log => {
            const logDate = new Date(log.date);
            return logDate >= weekStart && logDate <= today;
        });
        
        // Only count locked (closed) days for final stats
        const closedLogs = logs.filter(l => l.locked);
        const todayLog = logs.find(l => !l.locked);
        
        const stats = {
            totalDays: this.getDaysInWeekSoFar(),
            trackedDays: closedLogs.length + (todayLog ? 1 : 0),
            completedDays: closedLogs.filter(l => l.lockedState === SettingsDayState.COMPLETED).length,
            partialDays: closedLogs.filter(l => l.lockedState === SettingsDayState.PARTIAL).length,
            missedDays: closedLogs.filter(l => l.lockedState === SettingsDayState.MISSED).length,
            skippedDays: closedLogs.filter(l => l.lockedState === SettingsDayState.SKIPPED).length,
            
            learningHours: closedLogs.reduce((sum, l) => sum + (l.learningHours || 0), 0),
            gymSessions: closedLogs.filter(l => DayStateManager.validateToggle('gym', l)).length,
            earlyWakeups: closedLogs.filter(l => DayStateManager.validateSleep(l, SettingsAuthority.current)).length,
            avgScreenTime: closedLogs.length > 0 
                ? closedLogs.reduce((sum, l) => sum + (l.screenTime || 0), 0) / closedLogs.length 
                : 0,
        };
        
        // Add today's data if exists
        if (todayLog) {
            stats.learningHours += todayLog.learningHours || 0;
            if (todayLog.workout) stats.gymSessions++;
        }
        
        // Calculate progress percentages
        const settings = SettingsAuthority.current;
        stats.learningProgress = Math.min(100, 
            (stats.learningHours / (stats.totalDays * settings.nonNegotiables.learning.minHoursDaily)) * 100);
        stats.gymProgress = Math.min(100, 
            (stats.gymSessions / settings.nonNegotiables.gym.minSessionsWeekly) * 100);
        
        dashboardData.week.stats = stats;
        
        return stats;
    },
    
    // Get number of days elapsed in current week
    getDaysInWeekSoFar() {
        const weekStart = SettingsAuthority.getWeekStartDate();
        const today = new Date(SettingsAuthority.getLogicalToday());
        const diffTime = today - weekStart;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        return Math.min(diffDays, 7);
    },
};

// Export for use in browser (window) and Node.js (module.exports)
if (typeof window !== 'undefined') {
    window.SettingsAuthority = SettingsAuthority;
    window.DayStateManager = DayStateManager;
    window.ToggleAuthority = ToggleAuthority;
    window.DayLockAuthority = DayLockAuthority;
    window.SkipDayAuthority = SkipDayAuthority;
    window.StreakAuthority = StreakAuthority;
    window.LifeScoreAuthority = LifeScoreAuthority;
    window.WeeklyStatsAuthority = WeeklyStatsAuthority;
    // Don't override DayState if already defined by habitSystem.js
    if (!window.DayState) {
        window.DayState = SettingsDayState;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SettingsAuthority,
        SettingsDayState,
        DayStateManager,
        ToggleAuthority,
        DayLockAuthority,
        SkipDayAuthority,
        StreakAuthority,
        LifeScoreAuthority,
        WeeklyStatsAuthority,
    };
}
