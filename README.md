# Productivity Command Center

A strict routine enforcer and productivity dashboard with SQL-based persistence.

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- npm (comes with Node.js)

### Installation

1. **Navigate to the project directory:**
   ```bash
   cd Ai-Tracker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open the dashboard:**
   - Navigate to `http://localhost:3000/index.html` in your browser

### Development Mode
For auto-restart on file changes:
```bash
npm run dev
```

---

## 🗄️ Database Architecture

### SQLite Schema

The application uses SQLite with the following normalized tables:

#### `daily_logs`
Primary table for daily tracking data.
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| date | TEXT | Unique date (YYYY-MM-DD) |
| wakeup_time | TEXT | Wake-up time (HH:MM) |
| learning_done | INTEGER | Boolean (0/1) |
| learning_hours | REAL | Hours spent learning |
| learned_today | TEXT | What was learned |
| workout_done | INTEGER | Boolean (0/1) |
| workout_type | TEXT | Type of workout |
| screen_time | REAL | Hours of screen time |
| mood | INTEGER | Mood score (1-5) |
| mit_1_text, mit_1_done | TEXT, INTEGER | MIT 1 |
| mit_2_text, mit_2_done | TEXT, INTEGER | MIT 2 |
| mit_3_text, mit_3_done | TEXT, INTEGER | MIT 3 |
| bedtime | TEXT | Bedtime (HH:MM) |
| life_score | REAL | Calculated life score |
| created_at, updated_at | TEXT | Timestamps |

#### `weekly_stats`
Aggregated weekly statistics (auto-calculated).
| Column | Type | Description |
|--------|------|-------------|
| week_start | TEXT | Monday of the week (unique) |
| week_end | TEXT | Sunday of the week |
| total_learning_hours | REAL | Sum of learning hours |
| gym_sessions | INTEGER | Count of workout days |
| avg_screen_time | REAL | Average screen time |
| avg_mood | REAL | Average mood |
| days_tracked | INTEGER | Number of days with data |
| consistency_score | REAL | Calculated consistency % |

#### `streaks`
Track discipline streaks with recovery system.
| Column | Type | Description |
|--------|------|-------------|
| streak_type | TEXT | learning, workout, sleep, screen |
| current_count | INTEGER | Current streak count |
| best_count | INTEGER | All-time best |
| last_activity_date | TEXT | Last activity date |
| broken_at | TEXT | When streak was broken |
| recovery_days | INTEGER | Days until recovery |

#### `projects`
Portfolio projects tracking.
| Column | Type | Description |
|--------|------|-------------|
| name | TEXT | Project name |
| hours | INTEGER | Hours invested |
| status | TEXT | completed/in-progress |

#### `tasks`
Dynamic daily tasks.
| Column | Type | Description |
|--------|------|-------------|
| date | TEXT | Date of task |
| text | TEXT | Task description |
| completed | INTEGER | Boolean (0/1) |

#### `life_score_history`
Historical life scores with component breakdown.

---

## 🔌 API Reference

### Base URL
```
http://localhost:3000/api
```

### Endpoints

#### Today's Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/today` | Get all today's data (log, tasks, streaks, week stats) |
| POST | `/today` | Save/update today's data |
| GET | `/day/:date` | Get data for a specific date |

#### History
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/history/:days` | Get last N days of history |
| GET | `/history/range/:start/:end` | Get history between dates |

#### Weekly Stats
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/week/current` | Get current week's stats with daily breakdown |
| GET | `/week/:weekStart` | Get specific week's stats |
| GET | `/weeks/:count` | Get multiple weeks of stats |

#### Streaks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/streaks` | Get all streaks |
| PUT | `/streaks/:type` | Update a streak |
| POST | `/streaks/:type/increment` | Increment a streak |
| POST | `/streaks/:type/break` | Break a streak |

#### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | Get all projects with stats |
| POST | `/projects` | Add a project |
| DELETE | `/projects/:id` | Delete a project |

#### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | Get today's tasks |
| POST | `/tasks` | Add a task |
| PUT | `/tasks/:id` | Update a task |
| DELETE | `/tasks/:id` | Delete a task |

#### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics/:period` | Get analytics data for period |
| GET | `/lifescore` | Get current life score |
| GET | `/lifescore/history/:days` | Get life score history |
| GET | `/skill-hours` | Get total skill hours |

#### Migration
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/migration-status` | Check if migrated from localStorage |
| POST | `/migrate` | Migrate data from localStorage |

---

## 📊 Weekly Progress Bar Calculations

The weekly progress bars are calculated using the following formulas:

### Learning Progress
```javascript
learningPercent = (total_learning_hours / 20) * 100
```
- **Target**: 20 hours per week
- **Source**: Sum of `learning_hours` from all daily logs in current week

### Gym Progress
```javascript
gymPercent = (gym_sessions / 5) * 100
```
- **Target**: 5 sessions per week
- **Source**: Count of days where `workout_done = 1` in current week

### Visual States
| State | Condition | Color |
|-------|-----------|-------|
| On Track | ≥70% | Green |
| Behind | 40-69% | Yellow/Orange |
| Critical | <40% | Red (pulsing) |

### Recalculation Triggers
Progress bars are recalculated when:
1. Daily log is saved (POST `/today`)
2. Dashboard is loaded (GET `/today`)
3. Analytics period changes
4. Manual refresh

---

## 🔄 Migration from localStorage

When the server starts and detects existing localStorage data:

1. **Automatic Detection**: Checks for `dashboardData` in localStorage
2. **Data Mapping**: Converts old format to new SQL schema
3. **API Call**: Sends to POST `/migrate` endpoint
4. **Verification**: Sets `migrated_from_localstorage` setting
5. **Fallback**: localStorage remains as backup if backend fails

### Manual Migration
If automatic migration doesn't trigger:
```javascript
// In browser console
const oldData = JSON.parse(localStorage.getItem('dashboardData'));
fetch('/api/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(oldData)
});
```

---

## 🎨 Life Score Formula

The life score (0-100) is calculated with weighted components:

| Component | Max Points | Calculation |
|-----------|------------|-------------|
| Learning | 30 | `min(learning_hours * 10, 30)` |
| Workout | 20 | 20 if done, 0 if not |
| Sleep | 20 | Based on wake-up time vs target |
| Screen Time | 15 | Based on hours vs goal |
| MITs | 15 | 5 points per completed MIT |
| Streak Bonus | 10 | Bonus for long streaks |
| Penalties | -variable | Broken streaks, excessive screen time |

### Penalties Applied
- Broken streak: -3 points per recovering streak
- Screen time >5h: -8 points
- Screen time 3-5h: -3 points
- No learning after 6pm: -5 points
- Late sleep: -8 points

---

## 📁 File Structure

```
Ai-Tracker/
├── data/
│   └── productivity.db    # SQLite database (auto-created)
├── api.js                 # Frontend API client
├── database.js            # Database module & queries
├── index.html             # Dashboard UI
├── package.json           # Node.js dependencies
├── README.md              # This file
├── script.js              # Frontend logic
├── server.js              # Express API server
└── style.css              # Dashboard styles
```

---

## 🛠️ Development

### Reset Database
```bash
npm run reset-db
```

### Database Location
```
./data/productivity.db
```

### Logging
Server logs all requests with timestamps:
```
2026-01-16T10:30:00.000Z GET /api/today
2026-01-16T10:30:01.000Z POST /api/today
```

---

## ⚠️ Notes

- The dashboard works **offline** with localStorage fallback if the backend is unavailable
- Data is synced to the backend when available
- Weekly stats are automatically recalculated on every daily log save
- SQLite database uses WAL mode for better concurrent access
- All dates are stored in YYYY-MM-DD format (UTC)
