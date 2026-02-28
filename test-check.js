const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'database', 'kargo.db');
    const db = new SQL.Database(fs.readFileSync(dbPath));
    
    // Pending kargolar tarihe göre
    console.log('\n--- Pending Cargos by Date ---');
    const pendingResult = db.exec(`
        SELECT delivery_date, COUNT(id) as cnt, SUM(weight_kg) as total_weight 
        FROM cargos 
        WHERE status = 'pending' 
        GROUP BY delivery_date 
        ORDER BY delivery_date 
        LIMIT 10
    `);
    if (pendingResult.length > 0) {
        pendingResult[0].values.forEach(row => {
            console.log(`Date: ${row[0]}, Count: ${row[1]}, Weight: ${row[2]} kg`);
        });
    }
    
    // Assigned kargolar tarihe göre
    console.log('\n--- Assigned Cargos by Date ---');
    const assignedResult = db.exec(`
        SELECT delivery_date, COUNT(id) as cnt
        FROM cargos 
        WHERE status = 'assigned' 
        GROUP BY delivery_date 
        ORDER BY delivery_date 
    `);
    if (assignedResult.length > 0) {
        assignedResult[0].values.forEach(row => {
            console.log(`Date: ${row[0]}, Count: ${row[1]}`);
        });
    }

    // in_transit kargolar
    console.log('\n--- In Transit Cargos ---');
    const transitResult = db.exec(`SELECT COUNT(id) FROM cargos WHERE status = 'in_transit'`);
    console.log('Count:', transitResult[0]?.values[0][0] || 0);

    // delivered kargolar
    console.log('\n--- Delivered Cargos ---');
    const deliveredResult = db.exec(`SELECT COUNT(id) FROM cargos WHERE status = 'delivered'`);
    console.log('Count:', deliveredResult[0]?.values[0][0] || 0);

    // Rotalar ve route_order
    console.log('\n--- Routes with route_order ---');
    const routeResult = db.exec(`
        SELECT id, status, plan_date, route_order
        FROM routes
        ORDER BY id DESC
        LIMIT 5
    `);
    if (routeResult.length > 0) {
        routeResult[0].values.forEach(row => {
            console.log(`Route ${row[0]}: Date=${row[1]}, Status=${row[2]}, Stations=${row[3]}`);
        });
    }
    
    // Route 35 için kargolar kontrolü
    console.log('\n--- Cargos for Route 35 stations (2025-12-27) ---');
    const route35Stations = [13,5,2,11,6,4,9];
    const placeholders = route35Stations.map(() => '?').join(',');
    const cargoCheck = db.exec(`
        SELECT status, COUNT(id) 
        FROM cargos 
        WHERE station_id IN (${route35Stations.join(',')}) AND delivery_date = '2025-12-27'
        GROUP BY status
    `);
    if (cargoCheck.length > 0) {
        cargoCheck[0].values.forEach(row => {
            console.log(`  Status: ${row[0]}, Count: ${row[1]}`);
        });
    } else {
        console.log('  No cargos found for these stations on 2025-12-27');
    }
}

check().catch(console.error);
