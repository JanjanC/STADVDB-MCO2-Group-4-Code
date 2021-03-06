const mysql = require('mysql');
const util = require('util');
const dotenv = require('dotenv');
dotenv.config();

class Dao {
    static NODES = [
        {
            host: 'stadvdb-node-01.mysql.database.azure.com',
            port: 3306,
            user: 'user',
            password: 'password.12345',
            database: 'imdb_ijs',
            connectionLimit: 30,
            connectTimeout: 3000,
        },
        {
            host: 'stadvdb-node-02.mysql.database.azure.com',
            port: 3306,
            user: 'user',
            password: 'password.12345',
            database: 'imdb_ijs',
            connectionLimit: 30,
            connectTimeout: 3000,
        },
        {
            host: 'stadvdb-node-03.mysql.database.azure.com',
            port: 3306,
            user: 'user',
            password: 'password.12345',
            database: 'imdb_ijs',
            connectionLimit: 30,
            connectTimeout: 3000,
        },
    ];
    static MESSAGES = {
        ACKNOWLEDGED: 'ACKNOWLEDGED',
        UNACKNOWLEDGED: 'UNACKNOWLEDGED',
        SENT: 'SENT',
        CONNECTED: 'CONNECTED',
        UNCONNECTED: 'UNCONNECTED',
    };
    static tables = {
        imdb: 'movies',
        inbox: 'messages_received',
        outbox: 'messages_to_send',
    };
    static imdb = {
        id: 'id',
        name: 'name',
        year: 'year',
        rating: 'rating',
        genre: 'genre',
        director: 'director',
        actor_1: 'actor_1',
        actor_2: 'actor_2',
    };
    static inbox = {
        id: 'id',
        sender: 'sender',
        message: 'message',
        status: 'message_status', // default unacknowledged
    };
    static outbox = {
        id: 'id',
        recipient: 'recipient',
        message: 'message',
        status: 'message_status', // default unacknowledged
    };

    connection;
    isDown;
    query;
    node;
    pool;
    lastSQLObject;

    constructor(node) {
        this.node = node;
    }

    initialize(pool) {
        console.log('in initialize of node #' + (this.node + 1));
        this.pool = pool;

        /**
         *
         * @param {String} query - The very command that's executing and directly connected to the MySQL database
         * @param {any[]} options
         * @returns Promise of
         */
        let promiseQuery = (query, options) => {
            console.log('query in node ' + (this.node + 1) + ': ' + query);
            console.log('\twith values: ' + JSON.stringify(options));
            return new Promise((resolve, reject) => {
                this.lastSQLObject = this.connection.query(query, options, function (error, results) {
                    if (error) console.log(error.message);
                    if (error) reject(error);
                    else resolve(results);
                });
            }).catch((error) => {
                console.log('catch in init' + error.message + ' ' + error.errno);
                if (error && (error.errno == -3008 || error.errno == -4077 || error.message == 'connect ETIMEDOUT')) this.isDown = true;
                return Promise.reject(error);
            });
        };
        let unconnectedQuery = (query, options) => {
            console.log('fake query in node ' + (this.node + 1) + ': ' + query);
            console.log('\twith values: ' + JSON.stringify(options));
            // try {
            //     await this.initialize();
            //     this.query = promiseQuery;
            //     return promiseQuery(query, options);
            // } catch {
            //     console.log('Node ' + this.node + ' failed to reconnect');
            return Promise.reject(Dao.MESSAGES.UNCONNECTED);
            //}
        };

        return new Promise((resolve, reject) => {
            this.pool.getConnection(async (error, conn) => {
                if (error) {
                    console.log('Node ' + (this.node + 1) + ' errored in connecting: ' + error.message + ' ' + error.errno);
                    if (this.query == undefined) this.query = unconnectedQuery;
                    this.isDown = true;
                    reject(Dao.MESSAGES.UNCONNECTED);
                } else {
                    this.connection = conn;
                    this.query = promiseQuery;
                    try {
                        await this.connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${process.env.ISOLATION_LEVEL}`);
                    } catch (error) {
                        console.log('err while setting transaction level' + error);
                        reject(Dao.MESSAGES.UNCONNECTED);
                    }
                    this.isDown = false;
                    resolve(Dao.MESSAGES.CONNECTED);
                }
            });
        });
    }

    killConnection() {
        console.log('Killed conection for Node ' + (this.node + 1));
        this.query = (query, options) => {
            console.log('fake query in node ' + (this.node + 1) + ': ' + query);
            console.log('\twith values: ' + JSON.stringify(options));
            return Promise.reject(Dao.MESSAGES.UNCONNECTED);
        };
        this.isDown = true;
    }

    insert(id, name, year, rating, genre, director, actor_1, actor_2) {
        rating = rating ? rating : null;
        genre = genre ? genre : null;
        actor_1 = actor_1 ? actor_1 : null;
        actor_2 = actor_2 ? actor_2 : null;
        director = director ? director : null;

        return this.query('START TRANSACTION;').then((result) => {
            console.log('PROCEEDING WITH INSERT');
            return this.query(
                `
                INSERT INTO ${Dao.tables.imdb} (${Dao.imdb.id}, ${Dao.imdb.name}, ${Dao.imdb.year}, ${Dao.imdb.rating}, ${Dao.imdb.genre}, ${Dao.imdb.director}, ${Dao.imdb.actor_1}, ${Dao.imdb.actor_2})
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            `,
                [id, name, year, rating, genre, director, actor_1, actor_2]
            );
        });
    }

    update(id, name, year, rating, genre, director, actor_1, actor_2, changed) {
        rating = rating ? rating : null;
        genre = genre ? genre : null;
        actor_1 = actor_1 ? actor_1 : null;
        actor_2 = actor_2 ? actor_2 : null;
        director = director ? director : null;
        
        let query = `INSERT INTO ${Dao.tables.imdb} (${Dao.imdb.id}, ${Dao.imdb.name}, ${Dao.imdb.year}, ${Dao.imdb.rating}, ${Dao.imdb.genre}, ${Dao.imdb.director}, ${Dao.imdb.actor_1}, ${Dao.imdb.actor_2})
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
        `;
        
        let changedValues = [];
        if (changed.movie_name) {
            query += `${Dao.imdb.name} = ?`
            changedValues.push(name);
        }
        if (changed.year) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.year} = ?`
            changedValues.push(year);
        }
        if (changed.rating) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.rating} = ?`
            changedValues.push(rating);
        }
        if (changed.genre) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.genre} = ?`
            changedValues.push(genre);
        }
        if (changed.director) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.director} = ?`
            changedValues.push(director);
        }
        if (changed.actor_1) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.actor_1} = ?`
            changedValues.push(actor_1);
        }
        if (changed.actor_2) {
            if (query.slice(-1) == "?") query += ", "
            query += `${Dao.imdb.actor_2} = ?`
            changedValues.push(actor_2);
        }
        if (Object.values(changed).indexOf(true) == -1) {
            query += `${Dao.imdb.id} = ?`
            changedValues.push(id);
        }
        return this.query('START TRANSACTION;').then((result) => {
            return this.query(query,
                [id, name, year, rating, genre, director, actor_1, actor_2, ...changedValues]
            );
        });
    }

    delete(id) {
        return this.query('START TRANSACTION;').then((result) => {
            return this.query(
                `
                DELETE FROM ${Dao.tables.imdb}
                WHERE ${Dao.imdb.id} = ?
            `,
                [id]
            );
        });
    }

    find(id) {
        return this.query('START TRANSACTION;').then((result) => {
            return this.query(
                `
                SELECT * FROM ${Dao.tables.imdb}
                WHERE ${Dao.imdb.id} = ?
            `,
                [id]
            );
        });
    }

    findAll(page) {
        return this.query('START TRANSACTION;').then((result) => {
            return this.query(
                `
                SELECT * FROM ${Dao.tables.imdb} 
                LIMIT 20
                OFFSET ${(page - 1) * 20}
                `
            );
        });

        //return this.query(`SELECT * FROM ${Dao.tables.imdb};`)
    }

    searchMovie(name, page) {
        return this.query('START TRANSACTION;').then((result) => {
            return this.query(
                `
                SELECT * 
                FROM ${Dao.tables.imdb} 
                WHERE name LIKE ? 
                LIMIT 20 
                OFFSET ${(page - 1) * 20}`,
                [`%${name}%`]
            );
        });
    }

    commit() {
        //throw new Error('This is a fake error before the commit >:)');
        return this.query('COMMIT;');
        //return this.connection.commit();
    }

    rollback() {
        return this.query('ROLLBACK;');
    }

    startTransaction() {
        return this.query('START TRANSACTION;');
    }

    insertOutbox(date, recipient, query) {
        return this.query(
            `
            INSERT INTO ${Dao.tables.outbox} (${Dao.outbox.id}, ${Dao.outbox.recipient}, ${Dao.outbox.message}, ${Dao.outbox.status})
            VALUES(?, ?, ?, ?)
            `,
            [date, recipient, query, Dao.MESSAGES.UNACKNOWLEDGED]
        );
    }

    insertInbox(date, sender, query) {
        return this.query(
            `
            INSERT INTO ${Dao.tables.inbox} (${Dao.inbox.id}, ${Dao.inbox.sender}, ${Dao.inbox.message}, ${Dao.inbox.status})
            VALUES(?, ?, ?, ?)`,
            [date, sender, query, Dao.MESSAGES.UNACKNOWLEDGED]
        );
    }

    setMessageStatus(id, table, status) {
        let statusBox = table == Dao.tables.outbox ? Dao.outbox.status : Dao.inbox.status;
        let idBox = table == Dao.tables.outbox ? Dao.outbox.id : Dao.inbox.id;

        return this.query(
            `
            UPDATE ${table}
            SET ${statusBox} = ?
            WHERE ${idBox} = ?`,
            [status, id]
        );
    }
}

module.exports = { Dao };
