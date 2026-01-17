// ============================================
// HABIT SYSTEM - CORE LOGIC AUTHORITY (v11)
// ============================================
// This file controls ALL habit-related logic.
// UI components must request changes through this system.
// Direct state mutations are prohibited.
//
// v11 CORE PRINCIPLES:
// - Only deliberate actions change outcomes
// - Silence should never feel like punishment
// - Settings = Single Source of Truth
// ============================================

/**
 * HABIT REGISTRY
 * Central definition of all trackable habits
 * Settings defines which are enabled & affect day completion
 */
const HabitRegistry = {
    habits: {
        learning: {
            id: 'learning',
            name: 'Learning',
            icon: 'fa-book',
            type: 'binary-with-data',  // binary | numeric | binary-with-data
            dataFields: ['hours', 'topic'],
            defaultEnabled: true,
            streakEnabled: true,
            color: '#3b82f6',
            countsTowardCompletion: true  // v11: affects day completion
        },
        gym: {
            id: 'gym',
            name: 'Workout',
            icon: 'fa-dumbbell',
            type: 'binary-with-data',
            dataFields: ['type'],
            defaultEnabled: true,
            streakEnabled: true,
            color: '#8b5cf6',
            countsTowardCompletion: true
        },
        sleep: {
            id: 'sleep',
            name: 'Sleep',
            icon: 'fa-bed',
            type: 'time-based',
            dataFields: ['wakeupTime', 'bedtime'],
            defaultEnabled: true,
            streakEnabled: true,
            color: '#06b6d4',
            countsTowardCompletion: true
        },
        screenTime: {
            id: 'screenTime',
            name: 'Screen Time',
            icon: 'fa-mobile-alt',
            type: 'numeric',
            dataFields: ['hours'],
            defaultEnabled: true,
            streakEnabled: false,  // Screen time is a limit, not a streak
            color: '#f59e0b',
            inverted: true,  // Lower is better
            countsTowardCompletion: true
        }
    },
    
    getHabit(id) {
        return this.habits[id] || null;
    },
    
    getAllHabits() {
        return Object.values(this.habits);
    },
    
    getEnabledHabits(settings) {
        return this.getAllHabits().filter(h => {
            const habitSettings = settings?.nonNegotiables?.[h.id];
            return habitSettings?.enabled !== false;
        });
    },
    
    getStreakHabits(settings) {
        return this.getEnabledHabits(settings).filter(h => h.streakEnabled);
    },
    
    // v11: Get habits that affect day completion
    getCompletionHabits(settings) {
        return this.getEnabledHabits(settings).filter(h => {
            const habitSettings = settings?.nonNegotiables?.[h.id];
            // Check both default and settings override
            return habitSettings?.countsTowardCompletion !== false && h.countsTowardCompletion;
        });
    }
};

/**
 * DAY STATE MACHINE (v11 - STRICT 3 STATES)
 * 
 * ONLY THREE FINAL STATES:
 * - COMPLETED: Finalized + All required habits valid → Streak CONTINUES
 * - MISSED: Finalized + Habits invalid → Streak BREAKS
 * - NOT_COUNTED: No finalize → Streak PAUSED (neutral)
 */
const DayState = {
    // Final states (after save/finalize)
    COMPLETED: 'COMPLETED',
    MISSED: 'MISSED',
    NOT_COUNTED: 'NOT_COUNTED',
    // UI states (before finalization)
    NOT_STARTED: 'NOT_STARTED',
    IN_PROGRESS: 'IN_PROGRESS'
};

const DayStateMachine = {
    /**
     * Calculate the FINAL state of a day (v11 STRICT)
     * Only meaningful AFTER finalization
     * 
     * - NOT_COUNTED: Day not finalized → No consequence
     * - COMPLETED: Finalized + All habits valid → Streak+
     * - MISSED: Finalized + Habits invalid → Streak breaks
     */
    calculateState(dayLog, settings) {
        if (!dayLog) return DayState.NOT_COUNTED;
        
        // CRITICAL: If day was never finalized, it's NOT_COUNTED
        if (!dayLog.finalized) {
            return DayState.NOT_COUNTED;
        }
        
        // Day was finalized - check requirements
        const enabledHabits = HabitRegistry.getCompletionHabits(settings);
        
        // If no habits affect completion, finalized = COMPLETED
        if (enabledHabits.length === 0) {
            return DayState.COMPLETED;
        }
        
        // Check each enabled habit
        let allMet = true;
        enabledHabits.forEach(habit => {
            if (!this.isHabitComplete(habit.id, dayLog, settings)) {
                allMet = false;
            }
        });
        
        return allMet ? DayState.COMPLETED : DayState.MISSED;
    },
    
    /**
     * Get UI state for display (before finalization)
     */
    getUIState(dayLog, settings) {
        if (!dayLog) return DayState.NOT_STARTED;
        
        // If already finalized, show final state
        if (dayLog.finalized) {
            return this.calculateState(dayLog, settings);
        }
        
        // Check if any data entered
        if (!this.hasAnyData(dayLog)) {
            return DayState.NOT_STARTED;
        }
        
        return DayState.IN_PROGRESS;
    },
    
    /**
     * Check if a specific habit is complete for the day
     */
    isHabitComplete(habitId, dayLog, settings) {
        if (!dayLog) return false;
        
        const habitSettings = settings?.nonNegotiables?.[habitId];
        
        switch (habitId) {
            case 'learning':
                // Must have toggle ON and valid hours
                if (!dayLog.learningDone) return false;
                const minHours = habitSettings?.minHoursDaily || 0;
                return (dayLog.learningHours || 0) >= minHours;
                
            case 'gym':
                // Must have toggle ON
                return !!dayLog.workout;
                
            case 'sleep':
                // Wake up time must be within tolerance
                if (!dayLog.wakeUp) return false;
                const target = habitSettings?.wakeupTarget || '05:45';
                const tolerance = habitSettings?.wakeupTolerance || 30;
                return this.isWakeupOnTime(dayLog.wakeUp, target, tolerance);
                
            case 'screenTime':
                // Screen time must be under limit
                const limit = habitSettings?.dailyLimit || 3;
                return (dayLog.screenTime || 0) <= limit;
                
            default:
                return false;
        }
    },
    
    isWakeupOnTime(wakeupTime, targetTime, toleranceMinutes) {
        if (!wakeupTime) return false;
        const wakeup = new Date(`2000-01-01T${wakeupTime}`);
        const target = new Date(`2000-01-01T${targetTime}`);
        const diffMinutes = (wakeup - target) / 60000;
        return diffMinutes <= toleranceMinutes;
    },
    
    hasAnyData(dayLog) {
        if (!dayLog) return false;
        return dayLog.learningDone || 
               dayLog.workout || 
               dayLog.wakeUp ||
               (dayLog.screenTime && dayLog.screenTime > 0) ||
               (dayLog.learningHours && dayLog.learningHours > 0);
    },
    
    /**
     * Get completion percentage for a day
     */
    getCompletionPercent(dayLog, settings) {
        const enabledHabits = HabitRegistry.getEnabledHabits(settings);
        if (enabledHabits.length === 0) return 100;
        
        let completed = 0;
        enabledHabits.forEach(habit => {
            if (this.isHabitComplete(habit.id, dayLog, settings)) {
                completed++;
            }
        });
        
        return Math.round((completed / enabledHabits.length) * 100);
    }
};

/**
 * TOGGLE AUTHORITY (HABIT)
 * Controls all toggle behavior - each toggle is ISOLATED
 */
const HabitToggleAuthority = {
    /**
     * Request to change a toggle state
     * Returns: { allowed: boolean, reason?: string }
     */
    requestToggleChange(habitId, newState, currentData, settings) {
        const habit = HabitRegistry.getHabit(habitId);
        if (!habit) {
            return { allowed: false, reason: 'Unknown habit' };
        }
        
        // Check if habit is enabled in settings
        const habitSettings = settings?.nonNegotiables?.[habitId];
        if (habitSettings?.enabled === false) {
            return { allowed: false, reason: 'Habit is disabled in settings' };
        }
        
        // If turning OFF, always allowed
        if (!newState) {
            return { allowed: true };
        }
        
        // If turning ON, validate required data
        const validation = this.validateRequiredData(habitId, currentData, settings);
        if (!validation.valid) {
            return { allowed: false, reason: validation.reason };
        }
        
        return { allowed: true };
    },
    
    validateRequiredData(habitId, data, settings) {
        const habitSettings = settings?.nonNegotiables?.[habitId];
        const requiredFields = habitSettings?.requiredFields || [];
        
        switch (habitId) {
            case 'learning':
                if (requiredFields.includes('learningHours')) {
                    if (!data.hours || data.hours <= 0) {
                        return { valid: false, reason: 'Enter learning hours first' };
                    }
                }
                if (requiredFields.includes('learned')) {
                    if (!data.topic || data.topic.trim() === '') {
                        return { valid: false, reason: 'Enter what you learned first' };
                    }
                }
                break;
                
            case 'gym':
                if (requiredFields.includes('workoutType')) {
                    if (!data.type) {
                        return { valid: false, reason: 'Select workout type first' };
                    }
                }
                break;
        }
        
        return { valid: true };
    }
};

/**
 * STREAK AUTHORITY (v11 - PSYCHOLOGICALLY FAIR)
 * 
 * CRITICAL RULES:
 * - Streak = consecutive COMPLETED days
 * - NOT_COUNTED days: Do NOT break streak, Do NOT increment streak (PAUSED)
 * - Only MISSED days break streaks
 * 
 * Psychological principle:
 * "Only conscious failure has consequences. Inactivity is neutral."
 */
const HabitStreakAuthority = {
    /**
     * Update streak for a SINGLE habit after day is FINALIZED
     * Only called when day state is COMPLETED or MISSED
     * NOT_COUNTED days don't call this - streaks stay frozen
     */
    updateHabitStreak(habitId, dayLog, streakData, settings, dayState) {
        const habit = HabitRegistry.getHabit(habitId);
        if (!habit || !habit.streakEnabled) {
            return streakData; // No change for non-streak habits
        }
        
        // Check if habit is enabled
        const habitSettings = settings?.nonNegotiables?.[habitId];
        if (habitSettings?.enabled === false) {
            return streakData; // Disabled habits don't affect streaks
        }
        
        // v11: Only process if day was finalized
        if (!dayLog.finalized) {
            return streakData; // NOT_COUNTED - streak frozen (no change)
        }
        
        const isComplete = DayStateMachine.isHabitComplete(habitId, dayLog, settings);
        const currentStreak = streakData.current || 0;
        const recoveryDays = streakData.recoveryDays || 0;
        
        // If in recovery from a broken streak
        if (recoveryDays > 0) {
            if (isComplete) {
                const newRecovery = recoveryDays - 1;
                return {
                    ...streakData,
                    recoveryDays: newRecovery,
                    // If recovery complete, start incrementing again
                    current: newRecovery === 0 ? 1 : currentStreak,
                    lastUpdated: new Date().toISOString()
                };
            }
            return streakData; // Still in recovery, no change
        }
        
        // COMPLETED day - streak increases
        if (isComplete) {
            const newStreak = currentStreak + 1;
            return {
                ...streakData,
                current: newStreak,
                best: Math.max(newStreak, streakData.best || 0),
                lastUpdated: new Date().toISOString()
            };
        }
        
        // MISSED day (finalized but incomplete) - streak breaks
        // This is the ONLY way a streak can break
        return this.breakHabitStreak(habitId, streakData);
    },
    
    /**
     * Break a streak for a specific habit
     * Called ONLY when day is MISSED (finalized but requirements not met)
     */
    breakHabitStreak(habitId, streakData) {
        const currentStreak = streakData.current || 0;
        if (currentStreak === 0) return streakData;
        
        return {
            ...streakData,
            current: 0,
            best: Math.max(currentStreak, streakData.best || 0),
            lastBroken: new Date().toISOString(),
            recoveryDays: Math.min(Math.ceil(currentStreak / 3), 5)
        };
    },
    
    /**
     * Check if a streak should be at risk (visual warning)
     */
    isStreakAtRisk(habitId, dayLog, settings) {
        const habit = HabitRegistry.getHabit(habitId);
        if (!habit || !habit.streakEnabled) return false;
        
        const isComplete = DayStateMachine.isHabitComplete(habitId, dayLog, settings);
        if (isComplete) return false;
        
        // After 8 PM and not done = at risk
        const hour = new Date().getHours();
        return hour >= 20;
    }
};

/**
 * UI STATE CONTROLLER
 * Translates system state to UI visual states
 */
const UIStateController = {
    /**
     * Get visual state for the day header
     */
    getDayVisualState(dayLog, settings) {
        const state = DayStateMachine.calculateState(dayLog, settings, false);
        const completion = DayStateMachine.getCompletionPercent(dayLog, settings);
        
        return {
            state,
            completion,
            cssClass: this.getStateClass(state),
            label: this.getStateLabel(state),
            hint: this.getStateHint(state)
        };
    },
    
    getStateClass(state) {
        const classMap = {
            [DayState.UNDECIDED]: 'state-undecided',
            [DayState.IN_PROGRESS]: 'state-in-progress',
            [DayState.COMPLETED]: 'state-completed',
            [DayState.PARTIAL]: 'state-partial',
            [DayState.MISSED]: 'state-missed',
            [DayState.NOT_COUNTED]: 'state-not-counted'
        };
        return classMap[state] || 'state-undecided';
    },
    
    getStateLabel(state) {
        const labelMap = {
            [DayState.UNDECIDED]: 'No Data Yet',
            [DayState.IN_PROGRESS]: 'In Progress',
            [DayState.COMPLETED]: 'Completed',
            [DayState.PARTIAL]: 'Partial',
            [DayState.MISSED]: 'Missed',
            [DayState.NOT_COUNTED]: 'Not Counted'
        };
        return labelMap[state] || 'Unknown';
    },
    
    getStateHint(state) {
        const hintMap = {
            [DayState.UNDECIDED]: 'Start logging your activities',
            [DayState.IN_PROGRESS]: 'Keep going! Complete your habits.',
            [DayState.COMPLETED]: 'Great job! All goals achieved.',
            [DayState.PARTIAL]: 'Some habits incomplete.',
            [DayState.MISSED]: 'Day ended without completing habits.',
            [DayState.NOT_COUNTED]: 'Day not finalized - streak paused (neutral)'
        };
        return hintMap[state] || '';
    },
    
    /**
     * Get visual state for a specific habit card
     */
    getHabitVisualState(habitId, dayLog, streakData, settings) {
        const habit = HabitRegistry.getHabit(habitId);
        if (!habit) return null;
        
        const habitSettings = settings?.nonNegotiables?.[habitId];
        const isEnabled = habitSettings?.enabled !== false;
        const isComplete = DayStateMachine.isHabitComplete(habitId, dayLog, settings);
        const isAtRisk = HabitStreakAuthority.isStreakAtRisk(habitId, dayLog, settings);
        const inRecovery = (streakData?.recoveryDays || 0) > 0;
        
        return {
            enabled: isEnabled,
            complete: isComplete,
            atRisk: isAtRisk,
            inRecovery,
            streak: streakData?.current || 0,
            cssClass: this.getHabitClass(isEnabled, isComplete, isAtRisk, inRecovery)
        };
    },
    
    getHabitClass(enabled, complete, atRisk, inRecovery) {
        if (!enabled) return 'habit-disabled';
        if (complete) return 'habit-complete';
        if (inRecovery) return 'habit-recovery';
        if (atRisk) return 'habit-at-risk';
        return 'habit-pending';
    }
};

/**
 * HABIT SYSTEM FACADE
 * Main entry point for all habit operations
 */
const HabitSystem = {
    settings: null,
    
    /**
     * Initialize the habit system with settings
     */
    init(settings) {
        // Handle case where SettingsAuthority might not be loaded yet
        const defaultSettings = typeof SettingsAuthority !== 'undefined' 
            ? (SettingsAuthority?.current || SettingsAuthority?.defaults)
            : null;
        this.settings = settings || defaultSettings;
        console.log('[HabitSystem] Initialized');
    },
    
    /**
     * Request a toggle change - returns result with allowed/denied
     */
    requestToggle(habitId, newState, currentData) {
        return HabitToggleAuthority.requestToggleChange(habitId, newState, currentData, this.settings);
    },
    
    /**
     * Get current day state
     */
    getDayState(dayLog) {
        return DayStateMachine.calculateState(dayLog, this.settings, false);
    },
    
    /**
     * Check if habit is complete
     */
    isHabitComplete(habitId, dayLog) {
        return DayStateMachine.isHabitComplete(habitId, dayLog, this.settings);
    },
    
    /**
     * Update a specific habit's streak (NO cross-effects)
     */
    updateStreak(habitId, dayLog, currentStreak) {
        return HabitStreakAuthority.updateHabitStreak(habitId, dayLog, currentStreak, this.settings);
    },
    
    /**
     * Break a specific habit's streak
     */
    breakStreak(habitId, currentStreak) {
        return HabitStreakAuthority.breakHabitStreak(habitId, currentStreak);
    },
    
    /**
     * Get UI visual states
     */
    getDayVisuals(dayLog) {
        return UIStateController.getDayVisualState(dayLog, this.settings);
    },
    
    getHabitVisuals(habitId, dayLog, streakData) {
        return UIStateController.getHabitVisualState(habitId, dayLog, streakData, this.settings);
    },
    
    /**
     * Get completion percentage
     */
    getCompletion(dayLog) {
        return DayStateMachine.getCompletionPercent(dayLog, this.settings);
    },
    
    /**
     * Check if habit is enabled
     */
    isHabitEnabled(habitId) {
        const habitSettings = this.settings?.nonNegotiables?.[habitId];
        return habitSettings?.enabled !== false;
    },
    
    /**
     * Get all habits with their current state
     */
    getAllHabitStates(dayLog, streakData) {
        return HabitRegistry.getAllHabits().map(habit => ({
            ...habit,
            enabled: this.isHabitEnabled(habit.id),
            complete: this.isHabitComplete(habit.id, dayLog),
            streak: streakData?.[habit.id]?.current || 0,
            visuals: this.getHabitVisuals(habit.id, dayLog, streakData?.[habit.id])
        }));
    }
};

// Export for use in main script
if (typeof window !== 'undefined') {
    window.HabitRegistry = HabitRegistry;
    window.DayState = DayState;
    window.DayStateMachine = DayStateMachine;
    window.HabitToggleAuthority = HabitToggleAuthority;
    window.HabitStreakAuthority = HabitStreakAuthority;
    window.UIStateController = UIStateController;
    window.HabitSystem = HabitSystem;
}
