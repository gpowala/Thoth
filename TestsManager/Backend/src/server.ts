import express, { Request, Response } from 'express';
import multer from 'multer';
import os from 'os';

import { HttpContext } from './utils/http-context';
import { RecordingService } from './recording/recording-service';
import { RecordingSession } from './recording/recording-session';
import { parseTargetMeta } from './recording/events/target-meta';
import { initDatabase, getRepository, getDefaultDatabasePath } from './database/context';
import { getConfig, setConfig } from './utils/app-config';
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
  // Answer CORS preflight requests (needed for PUT/DELETE from the browser).
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
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
    // Optional additive target envelope (selectors + DOM/visual classification).
    const target = parseTargetMeta(req.body?.metadata);
    const clientTime = Number(req.query.clientTime);
    recordingService.registerClickEvent(guid as string, xCoord, yCoord, req.file.buffer, target, clientTime);
    res.status(200).send('Image trimmed and saved successfully.');
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).send('Error processing image.');
  }
});

app.post('/recording/events/area-select', upload.single('areaSelectView'), async (req: Request, res: Response) => {
  const { guid, top, bottom, left, right, dpr } = req.query;

  const topCoord = Number(top);
  const bottomCoord = Number(bottom);
  const leftCoord = Number(left);
  const rightCoord = Number(right);
  const devicePixelRatio = Number(dpr) || 1;

  if ([topCoord, bottomCoord, leftCoord, rightCoord].some(isNaN)) {
    return res.status(400).send('Missing or invalid top/bottom/left/right parameters. Must be numbers.');
  }

  if (!req.file) {
    return res.status(400).send('No image file uploaded.');
  }

  try {
    const clientTime = Number(req.query.clientTime);
    recordingService.registerAreaSelectEvent(guid as string, topCoord, bottomCoord, leftCoord, rightCoord, req.file.buffer, devicePixelRatio, clientTime);
    res.status(200).send('Area select event registered successfully.');
  } catch (error) {
    console.error('Error processing area-select image:', error);
    res.status(500).send('Error processing area-select image.');
  }
});

app.get('/recording/events/keypress', async (req: Request, res: Response) => {
    const { guid, key } = req.query;
    const clientTime = Number(req.query.clientTime);
    recordingService.registerKeypressEvent(guid as string, key as string, clientTime);
    res.status(200).send('Keypress event registered successfully.');
});

// Keystroke into an editable DOM field: carries the field target, so the backend
// buffers it into that field's input-event run instead of emitting a standalone
// keyboard text step (the visual/iframe GET path above).
app.post('/recording/events/keypress', upload.none(), async (req: Request, res: Response) => {
    const { guid } = req.query;
    const key = (req.body?.key as string) ?? '';
    const clientTime = Number(req.body?.clientTime);
    const target = parseTargetMeta(req.body?.metadata);
    recordingService.registerKeypressEvent(guid as string, key, clientTime, target);
    res.status(200).send('Keypress event registered successfully.');
});

app.post('/recording/events/scroll', upload.single('view'), async (req: Request, res: Response) => {
    const { guid } = req.query;
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);

    if (isNaN(x) || isNaN(y)) {
        return res.status(400).send('Missing or invalid x/y.');
    }
    if (!req.file) {
        return res.status(400).send('No image file uploaded.');
    }

    try {
        const target = parseTargetMeta(req.body?.metadata);
        const clientTime = Number(req.body?.clientTime);
        recordingService.registerScrollEvent(guid as string, x, y, req.file.buffer, target, clientTime);
        res.status(200).send('Scroll event registered successfully.');
    } catch (error) {
        console.error('Error processing scroll event:', error);
        res.status(500).send('Error processing scroll event.');
    }
});

app.post('/recording/events/input', upload.single('view'), async (req: Request, res: Response) => {
    const { guid } = req.query;
    const controlType = (req.body?.controlType as string) || 'other';
    const value = (req.body?.value as string) ?? '';
    const checked = req.body?.checked === 'true';
    const selectedText = req.body?.selectedText as string | undefined;

    if (!req.file) {
        return res.status(400).send('No image file uploaded.');
    }

    try {
        const target = parseTargetMeta(req.body?.metadata);
        const clientTime = Number(req.body?.clientTime);
        // Supplementary gathered keystroke sequence (JSON); tolerate malformed input.
        let keys;
        try { keys = req.body?.keys ? JSON.parse(req.body.keys) : undefined; } catch { keys = undefined; }
        recordingService.registerInputEvent(guid as string, controlType as any, value, checked, req.file.buffer, target, selectedText, clientTime, keys);
        res.status(200).send('Input event registered successfully.');
    } catch (error) {
        console.error('Error processing input event:', error);
        res.status(500).send('Error processing input event.');
    }
});

app.post('/recording/events/navigation', upload.single('view'), async (req: Request, res: Response) => {
    const { guid } = req.query;
    const url = (req.body?.url as string) ?? '';
    const navType = ((req.body?.navType as string) || 'load') as any;

    if (!url) {
        return res.status(400).send('Missing url.');
    }
    if (!req.file) {
        return res.status(400).send('No image file uploaded.');
    }

    try {
        const clientTime = Number(req.body?.clientTime);
        recordingService.registerNavigationEvent(guid as string, url, navType, req.file.buffer, clientTime);
        res.status(200).send('Navigation event registered successfully.');
    } catch (error) {
        console.error('Error processing navigation event:', error);
        res.status(500).send('Error processing navigation event.');
    }
});

app.get('/recording/session/generate', (req: Request, res: Response) => {
    const { guid, testName } = req.query;
    try {
        const { script, bundlePath } = recordingService.generateProject(guid as string, testName as string | undefined);
        res.status(200).json({ script, bundlePath });
    } catch (error) {
        console.error('Error generating script:', error);
        res.status(500).json({ error: 'Failed to generate script.' });
    }
});

const requireRepositoryExists = (repository: any) => {
    if (repository == null)
        throw Error('Repository does not exist');
}

const buildAuthenticatedUrl = (repository: any): string => {
    return repository.url.replace(
        'https://',
        `https://${encodeURIComponent(repository.user)}:${encodeURIComponent(repository.token)}@`
    );
};

const cloneGitRepository = async (repository: any) => {
    try {
        const targetDir = repository.directory;
        const authUrl = buildAuthenticatedUrl(repository);

        if (fs.existsSync(path.join(targetDir, '.git'))) {
            // Existing repository — pull the current branch using the provided credentials.
            const git = simpleGit(targetDir);
            const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
            await git.pull(authUrl, branch);
        } else {
            // New repository — clone into the target directory from its parent.
            const parentDir = path.dirname(targetDir);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            await simpleGit(parentDir).clone(authUrl, targetDir);
        }
    } catch (error) {
        console.error(`Error cloning repository: ${error}`);
        throw error;
    }
}

const initializeThotRepository = async (repository: any) => {
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
        const Repository = getRepository();

        // If the selected folder is already a git repo, use it directly.
        // Otherwise treat it as the parent and clone into <directory>/<name>.
        const selectedDirectory = directory as string;
        const isExisting = fs.existsSync(path.join(selectedDirectory, '.git'));
        const targetDirectory = isExisting
            ? selectedDirectory
            : path.join(selectedDirectory, String(name));

        let repository: any = await Repository.findOne({ where: { name: name as string } });
        if (!repository) {
            repository = await Repository.create({
                name: name as string,
                url: url as string,
                user: user as string,
                token: token as string,
                directory: targetDirectory
            });
        }

        requireRepositoryExists(repository);
        await cloneGitRepository(repository);

        await initializeThotRepository(repository);

        res.status(201).json(repository);
    } catch (error) {
        console.error('Error creating repository:', error);
        res.status(500).json({ error: 'An error occurred while creating the repository' });
    }
});

app.get('/repositories', async (req: Request, res: Response) => {
    try {
        const repositories = await getRepository().findAll();
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
        const repository = await getRepository().findByPk(id as string);

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

const stripUrlCredentials = (remoteUrl: string): { url: string; user: string } => {
    try {
        const parsed = new URL(remoteUrl);
        const user = parsed.username ? decodeURIComponent(parsed.username) : '';
        parsed.username = '';
        parsed.password = '';
        return { url: parsed.toString(), user };
    } catch {
        // Non-URL remotes (e.g. SSH git@host:org/repo.git) — return as-is.
        return { url: remoteUrl, user: '' };
    }
};

app.get('/repository/inspect', async (req: Request, res: Response) => {
    const requestedPath = (req.query.path as string | undefined)?.trim();
    if (!requestedPath) {
        return res.status(400).json({ error: 'A path is required.' });
    }

    try {
        const isGitRepo = fs.existsSync(path.join(requestedPath, '.git'));
        if (!isGitRepo) {
            return res.status(200).json({ isGitRepo: false });
        }

        const git = simpleGit(requestedPath);
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((r: any) => r.name === 'origin') ?? remotes[0];
        const fetchUrl: string = origin?.refs?.fetch ?? '';
        let { url, user } = fetchUrl ? stripUrlCredentials(fetchUrl) : { url: '', user: '' };

        // Fallback: if the remote URL has no embedded username, use the local
        // git identity (user.name) as a hint for the access user.
        if (!user) {
            try {
                user = (await git.raw(['config', '--get', 'user.name'])).trim();
            } catch {
                // No user.name configured — leave it blank.
            }
        }

        let branch = '';
        try {
            branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        } catch {
            branch = '';
        }

        return res.status(200).json({
            isGitRepo: true,
            name: path.basename(requestedPath),
            url,
            user,
            branch
        });
    } catch (error) {
        console.error('Error inspecting repository:', error);
        return res.status(400).json({ error: 'Failed to inspect the selected directory.' });
    }
});

app.get('/configuration', async (req: Request, res: Response) => {
    const config = getConfig();
    res.status(200).json({
        databasePath: config.databasePath,
        defaultDatabasePath: getDefaultDatabasePath()
    });
});

app.put('/configuration', async (req: Request, res: Response) => {
    const databasePath = (req.body?.databasePath as string | undefined)?.trim();

    if (!databasePath) {
        return res.status(400).json({ error: 'databasePath is required.' });
    }

    const parentDir = path.dirname(databasePath);
    if (!fs.existsSync(parentDir)) {
        return res.status(400).json({ error: `Directory does not exist: ${parentDir}` });
    }

    try {
        // Changing the database ends all active recording sessions.
        const killed = recordingService.destroyAllSessions();

        // Persist and hot-reconnect to the new database.
        setConfig({ databasePath });
        await initDatabase(databasePath);

        console.log(`Database switched to ${databasePath} (${killed} session(s) terminated).`);
        res.status(200).json({
            databasePath,
            defaultDatabasePath: getDefaultDatabasePath(),
            terminatedSessions: killed
        });
    } catch (error) {
        console.error('Error updating configuration:', error);
        // Attempt to restore the previous database connection.
        try {
            await initDatabase(getConfig().databasePath);
        } catch (restoreError) {
            console.error('Error restoring previous database connection:', restoreError);
        }
        res.status(400).json({ error: 'Failed to switch database. Previous database restored.' });
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

const bootstrap = async () => {
  const config = getConfig();
  await initDatabase(config.databasePath);

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
