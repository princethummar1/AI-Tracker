/**
 * API Client Module
 * Handles all communication with the backend
 */

const API = {
    BASE_URL: 'http://localhost:3000/api',
    
    // ============================================
    // HELPER METHODS
    // ============================================
    
    /**
     * Make a GET request
     */
    async get(endpoint) {
        try {
            const response = await fetch(`${this.BASE_URL}${endpoint}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`GET ${endpoint} failed:`, error);
            throw error;
        }
    },
    
    /**
     * Make a POST request
     */
    async post(endpoint, data) {
        try {
            const response = await fetch(`${this.BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`POST ${endpoint} failed:`, error);
            throw error;
        }
    },
    
    /**
     * Make a PUT request
     */
    async put(endpoint, data) {
        try {
            const response = await fetch(`${this.BASE_URL}${endpoint}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`PUT ${endpoint} failed:`, error);
            throw error;
        }
    },
    
    /**
     * Make a DELETE request
     */
    async delete(endpoint) {
        try {
            const response = await fetch(`${this.BASE_URL}${endpoint}`, {
                method: 'DELETE'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`DELETE ${endpoint} failed:`, error);
            throw error;
        }
    },
    
    /**
     * Check if backend is available
     */
    async isAvailable() {
        try {
            const response = await fetch(`${this.BASE_URL}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch {
            return false;
        }
    },
    
    // ============================================
    // TODAY / DAILY LOG
    // ============================================
    
    /**
     * Get all today's data
     */
    async getToday() {
        return this.get('/today');
    },
    
    /**
     * Save today's data
     */
    async saveToday(data) {
        return this.post('/today', data);
    },
    
    /**
     * Get data for a specific date
     */
    async getDay(date) {
        return this.get(`/day/${date}`);
    },
    
    // ============================================
    // HISTORY
    // ============================================
    
    /**
     * Get history for last N days
     */
    async getHistory(days = 30) {
        return this.get(`/history/${days}`);
    },
    
    /**
     * Get history between dates
     */
    async getHistoryRange(startDate, endDate) {
        return this.get(`/history/range/${startDate}/${endDate}`);
    },
    
    // ============================================
    // WEEKLY STATS
    // ============================================
    
    /**
     * Get current week's stats
     */
    async getCurrentWeek() {
        return this.get('/week/current');
    },
    
    /**
     * Get stats for a specific week
     */
    async getWeek(weekStart) {
        return this.get(`/week/${weekStart}`);
    },
    
    /**
     * Get multiple weeks of stats
     */
    async getWeeks(count = 12) {
        return this.get(`/weeks/${count}`);
    },
    
    // ============================================
    // STREAKS
    // ============================================
    
    /**
     * Get all streaks
     */
    async getStreaks() {
        return this.get('/streaks');
    },
    
    /**
     * Update a streak
     */
    async updateStreak(type, data) {
        return this.put(`/streaks/${type}`, data);
    },
    
    /**
     * Increment a streak
     */
    async incrementStreak(type) {
        return this.post(`/streaks/${type}/increment`);
    },
    
    /**
     * Break a streak
     */
    async breakStreak(type) {
        return this.post(`/streaks/${type}/break`);
    },
    
    // ============================================
    // PROJECTS
    // ============================================
    
    /**
     * Get all projects
     */
    async getProjects() {
        return this.get('/projects');
    },
    
    /**
     * Add a project
     */
    async addProject(name, hours, status = 'completed') {
        return this.post('/projects', { name, hours, status });
    },
    
    /**
     * Delete a project
     */
    async deleteProject(id) {
        return this.delete(`/projects/${id}`);
    },
    
    // ============================================
    // TASKS
    // ============================================
    
    /**
     * Get today's tasks
     */
    async getTasks() {
        return this.get('/tasks');
    },
    
    /**
     * Get tasks for a specific date
     */
    async getTasksForDate(date) {
        return this.get(`/tasks/${date}`);
    },
    
    /**
     * Add a task
     */
    async addTask(text, date = null) {
        return this.post('/tasks', { text, date });
    },
    
    /**
     * Update a task
     */
    async updateTask(id, data) {
        return this.put(`/tasks/${id}`, data);
    },
    
    /**
     * Delete a task
     */
    async deleteTask(id) {
        return this.delete(`/tasks/${id}`);
    },
    
    // ============================================
    // LIFE SCORE
    // ============================================
    
    /**
     * Get current life score
     */
    async getLifeScore() {
        return this.get('/lifescore');
    },
    
    /**
     * Get life score history
     */
    async getLifeScoreHistory(days = 30) {
        return this.get(`/lifescore/history/${days}`);
    },
    
    // ============================================
    // ANALYTICS
    // ============================================
    
    /**
     * Get analytics data
     */
    async getAnalytics(period = 30) {
        return this.get(`/analytics/${period}`);
    },
    
    /**
     * Get total skill hours
     */
    async getTotalSkillHours() {
        return this.get('/skill-hours');
    },
    
    // ============================================
    // MIGRATION
    // ============================================
    
    /**
     * Check migration status
     */
    async getMigrationStatus() {
        return this.get('/migration-status');
    },
    
    /**
     * Migrate data from localStorage
     */
    async migrateFromLocalStorage(data) {
        return this.post('/migrate', data);
    },
    
    // ============================================
    // SETTINGS
    // ============================================
    
    /**
     * Get a setting
     */
    async getSetting(key) {
        return this.get(`/settings/${key}`);
    },
    
    /**
     * Set a setting
     */
    async setSetting(key, value) {
        return this.put(`/settings/${key}`, { value });
    },
    
    // ============================================
    // SETTINGS AUTHORITY
    // ============================================
    
    /**
     * Get system settings
     */
    async getSettings() {
        return this.get('/system-settings');
    },
    
    /**
     * Save system settings
     */
    async saveSettings(data) {
        return this.post('/system-settings', data);
    },
    
    /**
     * Get settings change history
     */
    async getSettingsHistory(limit = 50) {
        return this.get(`/settings-history?limit=${limit}`);
    },
    
    // ============================================
    // DAY STATE MANAGEMENT
    // ============================================
    
    /**
     * Lock/finalize a day
     */
    async lockDay(date, state, finalScore) {
        return this.post(`/day/${date}/lock`, { state, finalScore });
    },
    
    /**
     * Skip a day
     */
    async skipDay(date, reason) {
        return this.post(`/day/${date}/skip`, { reason });
    },
    
    /**
     * Get day state log
     */
    async getDayStateLog(date) {
        return this.get(`/day/${date}/state-log`);
    },
    
    /**
     * Get days by state for a period
     */
    async getDaysByState(startDate, endDate) {
        return this.get(`/days-by-state?start=${startDate}&end=${endDate}`);
    },
    
    /**
     * Close all unlocked days before a date
     */
    async closeDays(beforeDate) {
        return this.post('/close-days', { beforeDate });
    },
    
    /**
     * Fill in missed days
     */
    async fillMissedDays(startDate, endDate) {
        return this.post('/fill-missed-days', { startDate, endDate });
    },
    
    /**
     * Reset all data (development only)
     */
    async resetAllData() {
        return this.post('/reset', {});
    }
};

// Export for ES modules (if needed)
if (typeof window !== 'undefined') {
    window.API = API;
}
