class RouteOptimizer {
    constructor(stations, distances, vehicles, cargos) {
        this.stations = stations;
        this.distances = distances;
        this.vehicles = vehicles.sort((a, b) => b.capacity_kg - a.capacity_kg);
        this.cargos = cargos;
        this.center = stations.find(s => s.is_center === 1);
        this.distanceMatrix = this.buildDistanceMatrix();
    }

    buildDistanceMatrix() {
        const matrix = {};
        this.distances.forEach(d => {
            if (!matrix[d.from_station_id]) matrix[d.from_station_id] = {};
            matrix[d.from_station_id][d.to_station_id] = {
                distance: parseFloat(d.distance_km),
                duration: parseFloat(d.duration_min || 0),
                geometry: d.route_geometry
            };
        });
        return matrix;
    }

    getDistance(from, to) {
        if (from === to) return 0;
        if (this.distanceMatrix[from] && this.distanceMatrix[from][to]) {
            return this.distanceMatrix[from][to].distance;
        }
        return this.haversineDistance(from, to);
    }

    haversineDistance(fromId, toId) {
        const from = this.stations.find(s => s.id === fromId);
        const to = this.stations.find(s => s.id === toId);
        if (!from || !to) return 100;
        const R = 6371;
        const dLat = (to.latitude - from.latitude) * Math.PI / 180;
        const dLon = (to.longitude - from.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(from.latitude * Math.PI / 180) * Math.cos(to.latitude * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c * 1.3;
    }

    getCargoSummary() {
        const summary = {};
        this.cargos.forEach(cargo => {
            const stationId = Number(cargo.station_id);
            if (!summary[stationId]) {
                summary[stationId] = { count: 0, weight: 0, cargoIds: [] };
            }
            summary[stationId].count++;
            summary[stationId].weight += parseFloat(cargo.weight_kg);
            summary[stationId].cargoIds.push(cargo.id);
        });
        return summary;
    }

    optimizeRouteOrder(stationIds) {
        if (stationIds.length <= 1) return stationIds;

        const centerId = this.center.id;
        const optimizedRoute = [];
        const remaining = [...stationIds];

        let currentStation = centerId;

        while (remaining.length > 0) {
            let nearestIdx = 0;
            let nearestDist = this.getDistance(currentStation, remaining[0]);

            for (let i = 1; i < remaining.length; i++) {
                const dist = this.getDistance(currentStation, remaining[i]);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = i;
                }
            }

            currentStation = remaining[nearestIdx];
            optimizedRoute.push(currentStation);
            remaining.splice(nearestIdx, 1);
        }

        return optimizedRoute;
    }

    calculateRouteDistance(stationIds) {
        if (stationIds.length === 0) return 0;

        let totalDistance = 0;
        const centerId = this.center.id;

        for (let i = 0; i < stationIds.length - 1; i++) {
            totalDistance += this.getDistance(stationIds[i], stationIds[i + 1]);
        }

        totalDistance += this.getDistance(stationIds[stationIds.length - 1], centerId);

        return totalDistance;
    }

    calculateRouteCost(distance, vehicle) {
        const fuelCost = distance * 1.0;
        const rentalCost = vehicle.is_rented ? (vehicle.rental_cost || 200) : 0;
        return fuelCost + rentalCost;
    }

    solveUnlimitedVehicles() {
        const startTime = Date.now();
        const cargoSummary = this.getCargoSummary();
        const stationsWithCargo = Object.keys(cargoSummary).map(Number);

        if (stationsWithCargo.length === 0) {
            return this.emptyResult('Taşınacak kargo yok', startTime);
        }

        let totalWeight = 0;
        Object.values(cargoSummary).forEach(c => totalWeight += c.weight);

        const ownVehicles = this.vehicles.filter(v => v.is_rented === 0)
            .sort((a, b) => b.capacity_kg - a.capacity_kg);
        const ownCapacity = ownVehicles.reduce((sum, v) => sum + v.capacity_kg, 0);

        console.log(`Toplam kargo ağırlığı: ${totalWeight} kg, Mevcut kapasite: ${ownCapacity} kg`);

        const vehicleAssignments = [];
        const usedVehicleIds = new Set();
        const rentedVehicles = [];

        const sortedStations = stationsWithCargo
            .map(id => ({ id, ...cargoSummary[id] }))
            .sort((a, b) => b.weight - a.weight);

        for (const station of sortedStations) {
            let assigned = false;

            for (const assignment of vehicleAssignments) {
                if (assignment.weight + station.weight <= assignment.vehicle.capacity_kg) {
                    assignment.stations.push(station.id);
                    assignment.weight += station.weight;
                    assigned = true;
                    break;
                }
            }

            if (!assigned) {
                for (const vehicle of ownVehicles) {
                    if (!usedVehicleIds.has(vehicle.id) && station.weight <= vehicle.capacity_kg) {
                        usedVehicleIds.add(vehicle.id);
                        vehicleAssignments.push({
                            vehicle,
                            stations: [station.id],
                            weight: station.weight
                        });
                        assigned = true;
                        break;
                    }
                }
            }

            if (!assigned) {
                let assignedToRented = false;
                for (const assignment of vehicleAssignments.filter(a => a.vehicle.is_rented)) {
                    if (assignment.weight + station.weight <= assignment.vehicle.capacity_kg) {
                        assignment.stations.push(station.id);
                        assignment.weight += station.weight;
                        assignedToRented = true;
                        break;
                    }
                }

                if (!assignedToRented) {
                    const rentedVehicleCapacity = 500;
                    const rentedVehicle = {
                        id: 1000 + rentedVehicles.length,
                        name: `Kiralık Araç ${rentedVehicles.length + 1}`,
                        capacity_kg: rentedVehicleCapacity,
                        rental_cost: 200,
                        is_rented: 1
                    };
                    
                    if (station.weight > rentedVehicleCapacity) {
                        rentedVehicle.capacity_kg = Math.ceil(station.weight / 100) * 100;
                        rentedVehicle.rental_cost = Math.ceil(station.weight / 500) * 200;
                    }

                    rentedVehicles.push(rentedVehicle);
                    vehicleAssignments.push({
                        vehicle: rentedVehicle,
                        stations: [station.id],
                        weight: station.weight
                    });
                }
            }
        }

        const routes = vehicleAssignments.map(assignment => {
            const optimizedStations = this.optimizeRouteOrder(assignment.stations);
            const distance = this.calculateRouteDistance(optimizedStations);
            const cost = this.calculateRouteCost(distance, assignment.vehicle);

            return {
                vehicle: assignment.vehicle,
                stations: optimizedStations,
                weight: assignment.weight,
                distance,
                cost
            };
        });

        return this.buildResult(routes, cargoSummary, rentedVehicles, 'unlimited_vehicles', startTime);
    }

    solveLimitedVehicles(optimizationType = 'max_cargo_count') {
        const startTime = Date.now();
        const cargoSummary = this.getCargoSummary();
        const stationsWithCargo = Object.keys(cargoSummary).map(Number);

        if (stationsWithCargo.length === 0) {
            return this.emptyResult('Taşınacak kargo yok', startTime);
        }

        const availableVehicles = this.vehicles.filter(v => v.is_rented === 0)
            .sort((a, b) => b.capacity_kg - a.capacity_kg);

        if (availableVehicles.length === 0) {
            return this.emptyResult('Kullanılabilir araç yok', startTime);
        }

        let sortedStations;
        if (optimizationType === 'max_cargo_weight') {
            sortedStations = stationsWithCargo
                .map(id => ({ id, ...cargoSummary[id] }))
                .sort((a, b) => b.weight - a.weight);
        } else {
            sortedStations = stationsWithCargo
                .map(id => ({ id, ...cargoSummary[id] }))
                .sort((a, b) => b.count - a.count);
        }

        const vehicleAssignments = availableVehicles.map(vehicle => ({
            vehicle,
            stations: [],
            weight: 0,
            cargoCount: 0
        }));

        const assignedStations = new Set();
        const unassignedStations = [];

        for (const station of sortedStations) {
            let assigned = false;

            let bestVehicleIdx = -1;
            let bestRemainingCapacity = Infinity;

            for (let i = 0; i < vehicleAssignments.length; i++) {
                const assignment = vehicleAssignments[i];
                const remainingCapacity = assignment.vehicle.capacity_kg - assignment.weight;

                if (station.weight <= remainingCapacity && remainingCapacity < bestRemainingCapacity) {
                    bestVehicleIdx = i;
                    bestRemainingCapacity = remainingCapacity;
                }
            }

            if (bestVehicleIdx !== -1) {
                vehicleAssignments[bestVehicleIdx].stations.push(station.id);
                vehicleAssignments[bestVehicleIdx].weight += station.weight;
                vehicleAssignments[bestVehicleIdx].cargoCount += station.count;
                assignedStations.add(station.id);
                assigned = true;
            }

            if (!assigned) {
                unassignedStations.push(station);
            }
        }

        const routes = vehicleAssignments
            .filter(a => a.stations.length > 0)
            .map(assignment => {
                const optimizedStations = this.optimizeRouteOrder(assignment.stations);
                const distance = this.calculateRouteDistance(optimizedStations);
                const cost = this.calculateRouteCost(distance, assignment.vehicle);

                return {
                    vehicle: assignment.vehicle,
                    stations: optimizedStations,
                    weight: assignment.weight,
                    distance,
                    cost
                };
            });

        const result = this.buildResult(routes, cargoSummary, [], 'limited_vehicles', startTime);
        result.optimizationType = optimizationType;
        
        if (unassignedStations.length > 0) {
            result.unassignedCargos = {
                stationCount: unassignedStations.length,
                totalWeight: unassignedStations.reduce((sum, s) => sum + s.weight, 0),
                totalCount: unassignedStations.reduce((sum, s) => sum + s.count, 0),
                stations: unassignedStations.map(s => {
                    const station = this.stations.find(st => st.id === s.id);
                    return {
                        station_id: s.id,
                        station_name: station?.name || 'Bilinmiyor',
                        cargo_count: s.count,
                        weight_kg: s.weight
                    };
                })
            };
        }

        return result;
    }

    buildResult(routes, cargoSummary, rentedVehicles, problemType, startTime) {
        const resultRoutes = [];
        let totalDistance = 0;
        let totalCost = 0;
        let totalCargoCount = 0;
        let totalCargoWeight = 0;
        let vehiclesUsed = 0;

        for (const route of routes) {
            if (route.stations.length === 0) continue;

            vehiclesUsed++;

            let routeCargoCount = 0;
            let routeCargoWeight = 0;

            const routeDetails = route.stations.map((stationId, idx) => {
                const station = this.stations.find(s => s.id === stationId);
                const cargo = cargoSummary[stationId];

                if (cargo) {
                    routeCargoCount += cargo.count;
                    routeCargoWeight += cargo.weight;
                }

                return {
                    station_id: stationId,
                    station_name: station ? station.name : 'Bilinmiyor',
                    latitude: station ? station.latitude : 0,
                    longitude: station ? station.longitude : 0,
                    cargo_count: cargo ? cargo.count : 0,
                    cargo_weight: cargo ? cargo.weight : 0,
                    sequence: idx + 1
                };
            });

            const geometry = this.getRouteGeometry(route.stations);

            resultRoutes.push({
                vehicle_id: route.vehicle.id,
                vehicle_name: route.vehicle.name,
                vehicle_capacity: route.vehicle.capacity_kg,
                rental_cost: route.vehicle.is_rented ? (route.vehicle.rental_cost || 200) : 0,
                is_rented: route.vehicle.is_rented || 0,
                stations: routeDetails,
                distance_km: parseFloat(route.distance.toFixed(2)),
                cost: parseFloat(route.cost.toFixed(2)),
                cargo_count: routeCargoCount,
                cargo_weight: parseFloat(routeCargoWeight.toFixed(2)),
                capacity_usage: ((routeCargoWeight / route.vehicle.capacity_kg) * 100).toFixed(1),
                geometry
            });

            totalDistance += route.distance;
            totalCost += route.cost;
            totalCargoCount += routeCargoCount;
            totalCargoWeight += routeCargoWeight;
        }

        return {
            success: true,
            routes: resultRoutes,
            summary: {
                totalDistance: parseFloat(totalDistance.toFixed(2)),
                totalCost: parseFloat(totalCost.toFixed(2)),
                totalCargoCount,
                totalCargoWeight: parseFloat(totalCargoWeight.toFixed(2)),
                vehiclesUsed,
                rentedVehiclesCount: rentedVehicles.length,
                totalRentalCost: rentedVehicles.reduce((sum, v) => sum + (v.rental_cost || 200), 0)
            },
            computationTime: Date.now() - startTime,
            problemType,
            rentedVehicles
        };
    }

    emptyResult(message, startTime) {
        return {
            success: true,
            message,
            routes: [],
            summary: {
                totalDistance: 0,
                totalCost: 0,
                totalCargoCount: 0,
                totalCargoWeight: 0,
                vehiclesUsed: 0,
                rentedVehiclesCount: 0,
                totalRentalCost: 0
            },
            computationTime: Date.now() - startTime
        };
    }

    getRouteGeometry(stationIds) {
        const geometry = [];
        if (stationIds.length === 0) return geometry;

        const centerId = this.center.id;

        const firstGeom = this.distanceMatrix[centerId]?.[stationIds[0]]?.geometry;
        if (firstGeom) {
            const fromStation = this.stations.find(s => s.id === centerId);
            const toStation = this.stations.find(s => s.id === stationIds[0]);
            geometry.push({
                from: centerId,
                to: stationIds[0],
                from_name: fromStation?.name || 'Merkez',
                to_name: toStation?.name || 'Bilinmiyor',
                polyline: firstGeom
            });
        }

        for (let i = 0; i < stationIds.length - 1; i++) {
            const geom = this.distanceMatrix[stationIds[i]]?.[stationIds[i + 1]]?.geometry;
            if (geom) {
                const fromStation = this.stations.find(s => s.id === stationIds[i]);
                const toStation = this.stations.find(s => s.id === stationIds[i + 1]);
                geometry.push({
                    from: stationIds[i],
                    to: stationIds[i + 1],
                    from_name: fromStation?.name || 'Bilinmiyor',
                    to_name: toStation?.name || 'Bilinmiyor',
                    polyline: geom
                });
            }
        }

        const lastGeom = this.distanceMatrix[stationIds[stationIds.length - 1]]?.[centerId]?.geometry;
        if (lastGeom) {
            const fromStation = this.stations.find(s => s.id === stationIds[stationIds.length - 1]);
            const toStation = this.stations.find(s => s.id === centerId);
            geometry.push({
                from: stationIds[stationIds.length - 1],
                to: centerId,
                from_name: fromStation?.name || 'Bilinmiyor',
                to_name: toStation?.name || 'Merkez',
                polyline: lastGeom
            });
        }

        return geometry;
    }
}

module.exports = RouteOptimizer;
