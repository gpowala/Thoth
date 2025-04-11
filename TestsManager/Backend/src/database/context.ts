import { Sequelize } from 'sequelize';
import path from 'path';

// Define the database file path
const dbPath = path.join(__dirname, '..', '..', 'thoth_tests_manager.sqlite');

// Create Sequelize instance
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false // Set to console.log to see SQL queries
});

// Define the Repositories model
import { DataTypes, Model } from 'sequelize';



class Repository extends Model {
  public id!: number;
  public name!: string;
  public directory!: string;
  public description!: string;
  public url!: string;
  public user!: string;
  public token!: string;
}

Repository.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  user: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  token: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  directory: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Repository',
  tableName: 'repositories',
});

// Sync the model with the database
sequelize.sync();

// Test the connection
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('Connection to the database has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}

// Initialize the database connection
export async function initDatabase() {
  await testConnection();
  // Here you can add any additional initialization logic,
  // such as syncing models or running migrations
}

export { sequelize, Repository };
