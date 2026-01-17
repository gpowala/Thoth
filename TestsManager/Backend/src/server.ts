import express, { Request, Response } from 'express';
import multer from 'multer';
import os from 'os';

import { HttpContext } from './utils/http-context';
import { RecordingService } from './recording/recording-service';
import { RecordingSession } from './recording/recording-session';
import { Repository } from './database/context';
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.argv[2]) || 3000; // Read port from Electron

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

app.use((req, res, next) => {
  req.query = Object.fromEntries(
      Object.entries(req.query).map(([key, value]) => [key, decodeURIComponent(value as string)])
  );
  next();
});

const httpContext = new HttpContext('http', os.hostname(), port);

const recordingService = new RecordingService(httpContext);
type DirectoryEntry = {
    name: string;
    path: string;
    hasChildren: boolean;
};

type DirectoryListResponse = {
    currentPath: string;
    parentPath: string;
    entries: DirectoryEntry[];
    isRoot: boolean;
};

const getWindowsDriveEntries = (): DirectoryEntry[] => {
    const entries: DirectoryEntry[] = [];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const letter of letters) {
        const drivePath = `${letter}:\\`;
        if (fs.existsSync(drivePath)) {
            entries.push({ name: drivePath, path: drivePath, hasChildren: true });
        }
    }
    return entries;
};

const hasChildDirectory = async (directoryPath: string) => {
    try {
        const dirents = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        return dirents.some((dirent: any) => dirent.isDirectory());
    } catch (error) {
        return false;
    }
};

const listDirectoryEntries = async (directoryPath: string): Promise<DirectoryListResponse> => {
    const resolvedPath = path.resolve(directoryPath);
    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isDirectory()) {
        throw new Error('Path is not a directory.');
    }

    const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    const directoryEntries = await Promise.all(
        dirents
            .filter((dirent: any) => dirent.isDirectory())
            .map(async (dirent: any) => {
                const fullPath = path.join(resolvedPath, dirent.name);
                return {
                    name: dirent.name,
                    path: fullPath,
                    hasChildren: await hasChildDirectory(fullPath)
                };
            })
    );

    directoryEntries.sort((a, b) => a.name.localeCompare(b.name));

    const parsedRoot = path.parse(resolvedPath).root;
    const isRoot = process.platform !== 'win32' && resolvedPath === parsedRoot;
    const parentPath = process.platform === 'win32' && resolvedPath === parsedRoot ? '' : path.dirname(resolvedPath);

    return {
        currentPath: resolvedPath,
        parentPath: isRoot ? '' : parentPath,
        entries: directoryEntries,
        isRoot: isRoot
    };
};

app.get('/recording/session/create', (req: Request, res: Response) => {
    const session = recordingService.createSession();
    res.json({ guid: session.id, url: session.getConnectionString() });
});

app.get('/recording/session/destroy', (req: Request, res: Response) => {
    const { guid } = req.query;
    recordingService.destroySession(guid as string);
    res.sendStatus(200);
});

app.get('/recording/session/start', (req: Request, res: Response) => {
    const { guid } = req.query;
    recordingService.startSession(guid as string);
    res.sendStatus(200);
});

app.get('/recording/session/stop', (req: Request, res: Response) => {
    const { guid } = req.query;
    recordingService.stopSession(guid as string);
    res.sendStatus(200);
});

app.get('/recording/session/resume', (req: Request, res: Response) => {
    const { guid } = req.query;
    const resumed = recordingService.resumeSession(guid as string);
    if (resumed) {
        console.log(`Session ${guid} resumed successfully`);
        res.sendStatus(200);
    } else {
        console.log(`Session ${guid} could not be resumed (not found or not started)`);
        res.sendStatus(404);
    }
});

app.get('/recording/session/is-active', (req: Request, res: Response) => {
    const { guid } = req.query;
    const isActive = recordingService.isActive(guid as string);
    res.json({ isActive });
});

app.get('/recording/session/update', (req: Request, res: Response) => {
    const { guid, nextEventId } = req.query;

    const isActive = recordingService.isActive(guid as string);
    
    const nextEventIdNumber = Number(nextEventId);
    const events = recordingService.getRecordedEvents(guid as string);
    const newEvents = events.length >= nextEventIdNumber ? events.slice(nextEventIdNumber) : [];
    
    console.log(`Session ${guid} is ${isActive ? 'active' : 'inactive'} with ${newEvents.length} new events`);
    res.json({ isActive: isActive, events: newEvents });
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/recording/events/click', upload.single('clickview'), async (req: Request, res: Response) => {
  const { guid, x, y } = req.query;
  
  const xCoord = Number(x);
  const yCoord = Number(y);

  if (isNaN(xCoord) || isNaN(yCoord)) {
    return res.status(400).send('Missing or invalid x and y parameters. Must be numbers.');
  }

  if (!req.file) {
    return res.status(400).send('No image file uploaded.');
  }

  try {
    recordingService.registerClickEvent(guid as string, xCoord, yCoord, req.file.buffer);
    res.status(200).send('Image trimmed and saved successfully.');
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).send('Error processing image.');
  }
});

app.get('/recording/events/keypress', async (req: Request, res: Response) => {
    const { guid, key } = req.query;
    recordingService.registerKeypressEvent(guid as string, key as string);
    res.status(200).send('Keypress event registered successfully.');
});

const requireRepositoryExists = (repository: Repository) => {
    if (repository == null)
        throw Error('Repository does not exist');
}

const cloneGitRepository = async (repository: Repository) => {
    try {
        if (!fs.existsSync(repository.directory)) {
            fs.mkdirSync(repository.directory, { recursive: true });
        }
        
        const remoteUrl = repository.url.replace(
            'https://', 
            `https://${repository.user}:${repository.token}@`
        );
        
        const git = simpleGit(repository.directory);
        if (fs.existsSync(path.join(repository.directory, '.git'))) {
            await git.pull('origin', 'main');
        } else {
            await git.clone(remoteUrl, repository.directory);
        }
    } catch (error) {
        console.error(`Error cloning repository: ${error}`);
        throw error;
    }
}

const initializeThotRepository = async (repository: Repository) => {
    try {
        const thotDirectory = path.join(repository.directory, 'thot');

        const scriptsDirectory = path.join(thotDirectory, 'scripts');
        const testsDirectory = path.join(thotDirectory, 'tests');
        const environmentsDirectory = path.join(thotDirectory, 'environments');

        const testsFile = path.join(thotDirectory, 'tests.thot');
        const testsFileContent = '{"scriptsDir": "scripts", "testsDir": "tests", "environmentsDir": "environments"}';

        if (!fs.existsSync(thotDirectory)) {
            fs.mkdirSync(thotDirectory, { recursive: true });

            fs.writeFileSync(testsFile, testsFileContent);
            
            fs.mkdirSync(scriptsDirectory, { recursive: true });
            fs.mkdirSync(testsDirectory, { recursive: true });
            fs.mkdirSync(environmentsDirectory, { recursive: true });

            console.log('Tests environment created successfully.');
        } else {
            console.log('Tests environment already exists, skipping creation.');
        }
    } catch (error) {
        console.error('Error initializing repository:', error);
        throw error;
    }

}

app.get('/repository', async (req: Request, res: Response) => {
    const { name, url, user, token, directory } = req.query;

    if (!name || !url || !user || !token || !directory) {
        return res.status(400).json({ error: 'Name, URL, user, token, and directory are required fields' });
    }

    try {
        let repository = await Repository.findOne({ where: { Name: name } });
        if (!repository) {
            repository = await Repository.create({
                name: name as string,
                url: url as string,
                user: user as string,
                token: token as string,
                directory: directory as string
            });
        }

        requireRepositoryExists(repository);
        await cloneGitRepository(repository);

        initializeThotRepository(repository);
        
        res.status(201).json(repository);
    } catch (error) {
        console.error('Error creating repository:', error);
        res.status(500).json({ error: 'An error occurred while creating the repository' });
    }
});

app.get('/repositories', async (req: Request, res: Response) => {
    try {
        const repositories = await Repository.findAll();
        res.status(200).json(repositories);
    } catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).json({ error: 'An error occurred while fetching repositories' });
    }
});

app.delete('/repository', async (req: Request, res: Response) => {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'Repository ID is required' });
    }

    try {
        const repository = await Repository.findByPk(id as string);

        if (!repository) {
            return res.status(404).json({ error: 'Repository not found' });
        }

        await repository.destroy();
        res.status(200).json({ message: 'Repository successfully deleted' });
    } catch (error) {
        console.error('Error deleting repository:', error);
        res.status(500).json({ error: 'An error occurred while deleting the repository' });
    }
});

app.get('/configuration/default-repositories-directory', async (req: Request, res: Response) => {
    const defaultRepositoryDirectory = path.join(__dirname, '..', '..', 'repositories');
    res.status(200).json({ defaultRepositoryDirectory: defaultRepositoryDirectory });
});

app.get('/filesystem/list', async (req: Request, res: Response) => {
    try {
        const requestedPath = (req.query.path as string | undefined)?.trim();
        if (!requestedPath) {
            if (process.platform === 'win32') {
                return res.status(200).json({
                    currentPath: '',
                    parentPath: '',
                    entries: getWindowsDriveEntries(),
                    isRoot: true
                });
            }

            const rootResponse = await listDirectoryEntries('/');
            return res.status(200).json({
                ...rootResponse,
                isRoot: true,
                parentPath: ''
            });
        }

        const response = await listDirectoryEntries(requestedPath);
        return res.status(200).json(response);
    } catch (error) {
        console.error('Error listing directories:', error);
        res.status(400).json({ error: 'Failed to list directories.' });
    }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
