const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'kargo.db');
let db = null;
let isInitialized = false;
let initPromise = null;

async function initDatabase() {
    if (isInitialized) return db;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        const SQL = await initSqlJs();
        
        let isNewDatabase = false;
        if (fs.existsSync(dbPath)) {
            const buffer = fs.readFileSync(dbPath);
            db = new SQL.Database(buffer);
        } else {
            db = new SQL.Database();
            isNewDatabase = true;
        }

        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            const statements = schema.split(';').filter(s => s.trim());
            for (const stmt of statements) {
                try {
                    const isInsert = stmt.trim().toUpperCase().startsWith('INSERT');
                    if (isInsert && !isNewDatabase) {
                        continue;
                    }
                    db.run(stmt);
                } catch (err) {
                    if (!err.message.includes('UNIQUE constraint failed')) {
                    }
                }
            }
            console.log('Veritabani semasi yuklendi.');
        }

        saveDatabase();
        isInitialized = true;
        return db;
    })();
    
    return initPromise;
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

const dbWrapper = {
    prepare: (sql) => {
        if (!isInitialized) {
            throw new Error('Veritabani henuz hazir degil. Lutfen initDatabase() fonksiyonunu bekleyin.');
        }
        return {
            run: (...params) => {
                try {
                    db.run(sql, params);
                    saveDatabase();
                    return { 
                        lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0],
                        changes: db.getRowsModified()
                    };
                } catch (err) {
                    console.error('SQL Error:', err.message, sql);
                    throw err;
                }
            },
            get: (...params) => {
                try {
                    const stmt = db.prepare(sql);
                    stmt.bind(params);
                    if (stmt.step()) {
                        const row = stmt.getAsObject();
                        stmt.free();
                        return row;
                    }
                    stmt.free();
                    return undefined;
                } catch (err) {
                    console.error('SQL Error:', err.message, sql);
                    throw err;
                }
            },
            all: (...params) => {
                try {
                    const stmt = db.prepare(sql);
                    stmt.bind(params);
                    const results = [];
                    while (stmt.step()) {
                        results.push(stmt.getAsObject());
                    }
                    stmt.free();
                    return results;
                } catch (err) {
                    console.error('SQL Error:', err.message, sql);
                    throw err;
                }
            }
        };
    },
    exec: (sql) => {
        if (!isInitialized) {
            throw new Error('Veritabani henuz hazir degil.');
        }
        db.exec(sql);
        saveDatabase();
    },
    transaction: (fn) => {
        return (...args) => {
            try {
                const result = fn(...args);
                saveDatabase();
                return result;
            } catch (err) {
                console.error('Transaction error:', err.message);
                throw err;
            }
        };
    }
};

function getDb() {
    return initPromise.then(() => dbWrapper);
}

module.exports = {
    initDatabase,
    getDb,
    prepare: (sql) => dbWrapper.prepare(sql),
    exec: (sql) => dbWrapper.exec(sql),
    transaction: (fn) => dbWrapper.transaction(fn)
};
