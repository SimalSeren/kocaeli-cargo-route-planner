const db = require('./database/db');

async function debug() {
    await db.initDatabase();
    
    console.log('=== DATABASE STATUS ===');
    console.log('Stations:', db.prepare('SELECT * FROM stations').all().length);
    console.log('Vehicles:', db.prepare('SELECT * FROM vehicles WHERE is_rented = 0').all());
    console.log('Distances:', db.prepare('SELECT COUNT(*) as count FROM distances').get());
    
    const cargos = db.prepare("SELECT * FROM cargos WHERE status = 'pending'").all();
    console.log('Pending Cargos:', cargos.length);
    
    if (cargos.length > 0) {
        console.log('Sample cargo:', cargos[0]);
        
        // Test optimizer
        const RouteOptimizer = require('./algorithms/routeOptimizer');
        const stations = db.prepare('SELECT * FROM stations').all();
        const distances = db.prepare('SELECT * FROM distances').all();
        // Tüm araçları al
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE is_rented = 0 ORDER BY capacity_kg DESC').all();
        
        console.log('\n=== OPTIMIZER INPUT ===');
        console.log('Stations count:', stations.length);
        console.log('Center:', stations.find(s => s.is_center === 1 || s.is_center === true));
        console.log('Distances count:', distances.length);
        console.log('Vehicles:', vehicles);
        
        const optimizer = new RouteOptimizer(stations, distances, vehicles, cargos);
        
        console.log('\n=== CARGO SUMMARY ===');
        const cargoSummary = optimizer.getCargoSummary();
        console.log('Stations with cargo (keys):', Object.keys(cargoSummary));
        
        // Object.keys().map(Number) sonuçlarını göster
        const stationsWithCargo = Object.keys(cargoSummary).map(Number);
        console.log('After Number conversion:', stationsWithCargo);
        console.log('Sample key type:', typeof stationsWithCargo[0]);
        
        console.log('\n=== DISTANCE MATRIX CHECK ===');
        const centerId = stations.find(s => s.is_center).id;
        console.log('Center ID:', centerId);
        console.log('Sample distance from center:', optimizer.getDistance(centerId, stationsWithCargo[0]));
        console.log('DistanceMatrix[1][2]:', optimizer.distanceMatrix[1]?.[2]);
        
        console.log('\n=== TESTING UNLIMITED VEHICLES ===');
        const unlimitedResult = optimizer.solveUnlimitedVehicles();
        console.log('Routes count:', unlimitedResult.routes?.length);
        console.log('Summary:', JSON.stringify(unlimitedResult.summary, null, 2));
        if (unlimitedResult.routes?.length > 0) {
            console.log('First route:', unlimitedResult.routes[0]);
        }
        
        console.log('\n=== TESTING MAX CARGO COUNT ===');
        const maxCountResult = optimizer.solveLimitedVehicles('max_cargo_count');
        console.log('Routes count:', maxCountResult.routes?.length);
        console.log('Summary:', JSON.stringify(maxCountResult.summary, null, 2));
        if (maxCountResult.routes?.length > 0) {
            console.log('First route stations:', maxCountResult.routes[0].stations?.map(s => s.station_name));
        }
        
        console.log('\n=== TESTING MAX CARGO WEIGHT ===');
        const maxWeightResult = optimizer.solveLimitedVehicles('max_cargo_weight');
        console.log('Routes count:', maxWeightResult.routes?.length);
        console.log('Summary:', JSON.stringify(maxWeightResult.summary, null, 2));
    }
    
    process.exit(0);
}

debug().catch(console.error);
