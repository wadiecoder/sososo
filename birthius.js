#!/usr/bin/env node

console.log('\x1b[36m%s\x1b[0m', '👋 Hello from wadius.com');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import ghpages from 'gh-pages';
import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateTemplate({ name, image, date }, outputDir) {
    const templatePath = path.join(__dirname, 'assets', 'index.html');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');

    let customizedContent = templateContent;
    customizedContent = customizedContent.replace(/\{\{\s*name\s*\}\}/g, name);
    customizedContent = customizedContent.replace(/\{\{\s*image\s*\}\}/g, image);
    customizedContent = customizedContent.replace(/\{\{\s*date\s*\}\}/g, date);
    customizedContent = customizedContent.replace(/\.\/assets\/image\.jpg/g, `./assets/${image}`);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(path.join(outputDir, 'assets'), { recursive: true });

    fs.writeFileSync(path.join(outputDir, 'index.html'), customizedContent);

    const cssSource = path.join(__dirname, 'assets', 'style.css');
    const jsSource = path.join(__dirname, 'assets', 'script.js');
    const musicSource = path.join(__dirname, 'assets', 'happy-birthday.mp3');
    
    fs.copyFileSync(cssSource, path.join(outputDir, 'style.css'));
    fs.copyFileSync(jsSource, path.join(outputDir, 'script.js'));
    fs.copyFileSync(musicSource, path.join(outputDir, 'assets', 'happy-birthday.mp3'));

    try {
        if (fs.existsSync(image)) {
            fs.copyFileSync(image, path.join(outputDir, 'assets', path.basename(image)));
        }
        else if (fs.existsSync(path.join(__dirname, 'assets', image))) {
            fs.copyFileSync(path.join(__dirname, 'assets', image), path.join(outputDir, 'assets', image));
        }
        else if (fs.existsSync(path.resolve(image))) {
            fs.copyFileSync(path.resolve(image), path.join(outputDir, 'assets', path.basename(image)));
        }
        else {
            console.warn(`⚠️ Warning: Could not find image file "${image}". Please make sure to add it manually to the assets folder.`);
        }
    } catch (error) {
        console.warn(`⚠️ Warning: Error copying image file: ${error.message}`);
    }

    console.log(`🎉 Birthday page generated in ${outputDir}`);
}

function deployToGitHubPages(outputDir) {
    ghpages.publish(outputDir, err => {
        if (err) {
            console.error('❌ Deployment failed:', err.message);
        } else {
            console.log('🚀 Successfully deployed to GitHub Pages!');
        }
    });
}

async function setupGitHub(repoName) {
    try {
        // Get GitHub token if not already stored
        let token = process.env.GITHUB_TOKEN;
        const tokenInstructions = 
            '\nTo create a token:\n' +
            '1. Go to https://github.com/settings/tokens\n' +
            '2. Click "Generate new token" (classic)\n' +
            '3. Give it a name (e.g., "birthday-page")\n' +
            '4. Select these scopes: repo, workflow\n' +
            '5. Click "Generate token"\n' +
            '6. Copy the token and paste it here\n';

        if (!token) {
            console.log('\x1b[33m%s\x1b[0m', tokenInstructions);
            const { token: newToken } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'token',
                    message: 'Please enter your GitHub personal access token:',
                    validate: input => input.length > 30 || 'Token seems too short. Please make sure you copied the entire token.'
                }
            ]);
            token = newToken;
        }

        // Test the token first
        const octokit = new Octokit({ auth: token });
        try {
            await octokit.rest.users.getAuthenticated();
        } catch (error) {
            // If token is invalid, remove it and try again
            if (error.message.includes('Bad credentials')) {
                console.error('❌ Invalid token.');
                // Remove token from environment if it exists
                if (process.env.GITHUB_TOKEN) {
                    console.log('🗑️  Removing invalid stored token...');
                    const envFile = path.join(process.env.HOME || process.env.USERPROFILE, '.bashrc');
                    if (fs.existsSync(envFile)) {
                        let content = fs.readFileSync(envFile, 'utf8');
                        content = content.replace(/\nexport GITHUB_TOKEN=.*\n/, '\n');
                        fs.writeFileSync(envFile, content);
                    }
                }
                process.env.GITHUB_TOKEN = null;
                // Try again with new token
                return setupGitHub(repoName);
            }
            throw error;
        }

        // If we get here, token is valid, save it
        if (!process.env.GITHUB_TOKEN) {
            const envFile = path.join(process.env.HOME || process.env.USERPROFILE, '.bashrc');
            fs.appendFileSync(envFile, `\nexport GITHUB_TOKEN="${token}"\n`);
            process.env.GITHUB_TOKEN = token;
        }

        // Get authenticated user
        const { data: { login } } = await octokit.rest.users.getAuthenticated();

        // Create repository
        try {
            await octokit.rest.repos.createForAuthenticatedUser({
                name: repoName,
                private: false,
                auto_init: true
            });
            console.log('✨ Repository created successfully!');
        } catch (error) {
            if (error.status !== 422) { // 422 means repo already exists
                throw error;
            }
        }

        // Initialize git and push to GitHub
        const git = simpleGit();
        
        try {
            // Clean up any existing git configuration
            if (fs.existsSync('.git')) {
                try {
                    fs.rmSync('.git', { recursive: true, force: true });
                } catch (error) {
                    console.log('Warning: Could not remove existing .git directory');
                }
            }

            // Initialize new git repository
            await git.init();
            await git.addConfig('user.name', login);
            await git.addConfig('user.email', `${login}@users.noreply.github.com`);
            await git.add('.');
            await git.commit('Initial commit');
            await git.branch(['-M', 'main']); // Ensure we're on main branch
            await git.addRemote('origin', `https://github.com/${login}/${repoName}.git`);
            await git.push(['-f', '-u', 'origin', 'main']);

            console.log('✨ Repository pushed successfully!');
        } catch (error) {
            console.error('Error during git operations:', error.message);
            // Continue with gh-pages deployment even if git push fails
        }

        // Deploy to gh-pages using gh-pages package
        await new Promise((resolve, reject) => {
            const options = {
                branch: 'gh-pages',
                repo: `https://github.com/${login}/${repoName}.git`,
                message: 'Auto-generated commit',
                force: true,
                git: {
                    config: {
                        'user.name': login,
                        'user.email': `${login}@users.noreply.github.com`
                    }
                },
                dotfiles: true,
                add: true
            };

            // Deploy from the output directory
            ghpages.publish(repoName, options, (err) => {
                if (err) {
                    console.error('Error deploying to gh-pages:', err.message);
                    reject(err);
                } else {
                    console.log('✨ Successfully deployed to gh-pages branch!');
                    resolve();
                }
            });
        });

        // Wait a bit for GitHub to process the changes
        console.log('Waiting for GitHub to process changes...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Enable GitHub Pages
        try {
            await octokit.rest.repos.createPagesSite({
                owner: login,
                repo: repoName,
                source: {
                    branch: "gh-pages",
                    path: "/"
                }
            });
            console.log('✨ GitHub Pages enabled successfully!');
        } catch (error) {
            // If GitHub Pages is already enabled, just continue
            if (error.message.includes('already enabled') || error.message.includes('already exists')) {
                console.log('✨ GitHub Pages already enabled!');
            } else {
                throw error;
            }
        }

        const pageUrl = `https://${login}.github.io/${repoName}`;
        console.log('\x1b[32m%s\x1b[0m', `✨ Your birthday page is live at: ${pageUrl}`);
        console.log('Note: It might take a few minutes for the page to be available.');
        return pageUrl;
    } catch (error) {
        console.error('❌ Error setting up GitHub:', error.message);
        throw error;
    }
}

const run = async () => {
    const answers = await inquirer.prompt([
        { 
            type: 'input', 
            name: 'name', 
            message: 'Enter the name for the birthday person:'
        },
        { 
            type: 'input', 
            name: 'image', 
            message: 'Enter the path to the image file (e.g., "./photos/image.jpg" or just "image.jpg" if in current directory):'
        },
        { 
            type: 'input', 
            name: 'date', 
            message: 'Enter the birthday date (e.g., 23 November 2024):'
        },
        { 
            type: 'input', 
            name: 'outputDir', 
            message: 'Enter the output directory (default: birthday-page):', 
            default: 'birthday-page'
        },
        { 
            type: 'confirm', 
            name: 'deploy', 
            message: 'Do you want to deploy this page to GitHub Pages?',
            default: true
        }
    ]);

    const { name, image, date, outputDir, deploy } = answers;

    generateTemplate({ name, image, date }, outputDir);

    if (deploy) {
        console.log('🚀 Setting up GitHub repository and deploying...');
        const repoName = outputDir;
        
        try {
            const pageUrl = await setupGitHub(repoName);
        } catch (error) {
            console.error('❌ Deployment failed:', error.message);
        }
    }
};

run().catch(console.error);
