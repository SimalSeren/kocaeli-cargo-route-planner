const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database/db');

const authRoutes = require('./routes/auth');
const stationRoutes = require('./routes/stations');
const cargoRoutes = require('./routes/cargos');
const vehicleRoutes = require('./routes/vehicles');
const routeRoutes = require('./routes/routes');
const scenarioRoutes = require('./routes/scenarios');
const planningRoutes = require('./routes/planning');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/cargos', cargoRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/planning', planningRoutes);

app.get('/api', (req, res) => {
    res.json({
        message: 'Kargo İşletme Sistemi API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            stations: '/api/stations',
            cargos: '/api/cargos',
            vehicles: '/api/vehicles',
            routes: '/api/routes',
            scenarios: '/api/scenarios',
            planning: '/api/planning'
        }
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Sunucu hatası', message: err.message });
});

async function startServer() {
    try {
        await db.initDatabase();
        app.listen(PORT, () => {
            console.log(`Kargo İşletme Sistemi Backend - Port: ${PORT}`);
            console.log(`API: http://localhost:${PORT}/api`);
        });
    } catch (error) {
        console.error('Sunucu başlatılamadı:', error);
        process.exit(1);
    }
}

startServer();
