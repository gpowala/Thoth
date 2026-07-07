import { Sequelize, DataTypes, ModelStatic, Model } from 'sequelize';
import path from 'path';

let sequelize: Sequelize | null = null;
let RepositoryModel: ModelStatic<Model> | null = null;

const defineRepository = (instance: Sequelize): ModelStatic<Model> => {
  return instance.define('Repository', {
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
    tableName: 'repositories',
  });
};

export const getDefaultDatabasePath = (): string => {
  return path.join(__dirname, '..', '..', 'thoth_tests_manager.sqlite');
};

/**
 * (Re)initialize the database connection against the given sqlite file.
 * Safe to call multiple times — the previous connection is closed first,
 * which lets the app switch databases at runtime (hot-reconnect).
 */
export async function initDatabase(dbPath?: string): Promise<void> {
  const storage = dbPath && dbPath.trim() ? dbPath.trim() : getDefaultDatabasePath();

  if (sequelize) {
    try {
      await sequelize.close();
    } catch (error) {
      console.error('Error closing previous database connection:', error);
    }
    sequelize = null;
    RepositoryModel = null;
  }

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: false,
  });

  RepositoryModel = defineRepository(sequelize);

  await sequelize.authenticate();
  await sequelize.sync();
  console.log(`Database connection established at: ${storage}`);
}

export function getSequelize(): Sequelize {
  if (!sequelize) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return sequelize;
}

export function getRepository(): ModelStatic<Model> {
  if (!RepositoryModel) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return RepositoryModel;
}
