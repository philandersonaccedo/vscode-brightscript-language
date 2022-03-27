import * as request from 'request';
import * as vscode from 'vscode';
import BrightScriptFileUtils from './BrightScriptFileUtils';
import { GlobalStateManager } from './GlobalStateManager';
import { brighterScriptPreviewCommand } from './commands/BrighterScriptPreviewCommand';
import { languageServerInfoCommand } from './commands/LanguageServerInfoCommand';
import { SceneGraphDebugCommandController } from 'roku-debug';
import { util } from './util';
import { util as rokuDebugUtil } from 'roku-debug/dist/util';
import { VSCodeContext } from './VscodeContext';

export class BrightScriptCommands {

    constructor() {
        this.fileUtils = new BrightScriptFileUtils();
    }

    private fileUtils: BrightScriptFileUtils;
    private context: vscode.ExtensionContext;
    private host: string;

    public registerCommands(context: vscode.ExtensionContext) {
        this.context = context;

        brighterScriptPreviewCommand.register(context);
        languageServerInfoCommand.register(context);

        this.registerCommand('toggleXML', async () => {
            await this.onToggleXml();
        });

        this.registerCommand('clearGlobalState', async () => {
            new GlobalStateManager(this.context).clear();
            await vscode.window.showInformationMessage('BrightScript Language extension global state cleared');
        });

        this.registerCommand('sendRemoteCommand', async (key: string) => {
            await this.sendRemoteCommand(key);
        });

        this.registerCommand('sendRemoteText', async () => {
            let items: vscode.QuickPickItem[] = [];
            for (const item of new GlobalStateManager(this.context).sendRemoteTextHistory) {
                items.push({ label: item });
            }

            const stuffUserTyped = await util.showQuickPickInputBox({
                placeholder: 'Press enter to send all typed characters to the Roku',
                items: items
            });
            console.log('userInput', stuffUserTyped);

            if (stuffUserTyped) {
                new GlobalStateManager(this.context).addTextHistory(stuffUserTyped);
                let fallbackToHttp = true;
                await this.getRemoteHost();
                //TODO fix SceneGraphDebugCommandController to not timeout so quickly
                // try {
                //     let commandController = new SceneGraphDebugCommandController(this.host);
                //     let response = await commandController.type(stuffUserTyped);
                //     if (!response.error) {
                //         fallbackToHttp = false;
                //     }
                // } catch (error) {
                //     console.error(error);
                //     // Let this fallback to the old HTTP based logic
                // }

                if (fallbackToHttp) {
                    for (let character of stuffUserTyped) {
                        await this.sendAsciiToDevice(character);
                    }
                }
            }
            await vscode.commands.executeCommand('workbench.action.focusPanel');
        });

        this.registerCommand('toggleRemoteControlMode', async () => {
            let currentMode = VSCodeContext.get('brightscript.remoteControlMode');
            await VSCodeContext.set('brightscript.remoteControlMode', !(currentMode));
        });

        this.registerCommand('pressBackButton', async () => {
            await this.sendRemoteCommand('Back');
        });

        this.registerCommand('pressBackspaceButton', async () => {
            await this.sendRemoteCommand('Backspace');
        });

        this.registerCommand('pressHomeButton', async () => {
            await this.sendRemoteCommand('Home');
        });

        this.registerCommand('pressUpButton', async () => {
            await this.sendRemoteCommand('Up');
        });

        this.registerCommand('pressDownButton', async () => {
            await this.sendRemoteCommand('Down');
        });

        this.registerCommand('pressRightButton', async () => {
            await this.sendRemoteCommand('Right');
        });

        this.registerCommand('pressLeftButton', async () => {
            await this.sendRemoteCommand('Left');
        });

        this.registerCommand('pressSelectButton', async () => {
            await this.sendRemoteCommand('Select');
        });

        this.registerCommand('pressPlayButton', async () => {
            await this.sendRemoteCommand('Play');
        });

        this.registerCommand('pressRevButton', async () => {
            await this.sendRemoteCommand('Rev');
        });

        this.registerCommand('pressFwdButton', async () => {
            await this.sendRemoteCommand('Fwd');
        });

        this.registerCommand('pressStarButton', async () => {
            await this.sendRemoteCommand('Info');
        });

        this.registerCommand('pressInstantReplayButton', async () => {
            await this.sendRemoteCommand('InstantReplay');
        });

        this.registerCommand('pressSearchButton', async () => {
            await this.sendRemoteCommand('Search');
        });

        this.registerCommand('pressEnterButton', async () => {
            await this.sendRemoteCommand('Enter');
        });

        this.registerKeyboardInputs();
    }

    /**
     * Registers all the commands for a-z, A-Z, 0-9, and all the primary character such as !, @, #, ', ", etc...
     */
    private registerKeyboardInputs() {
        // Create the primary ascii character list
        const asciiTable = Array.from(Array(95)).map((e, i) => i + 32);
        let asciiList = asciiTable.map((x) => String.fromCharCode(x));
        // Add any that where not cleanly in the range above such as TAB
        asciiList.push(...['\t']);

        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        for (let character of asciiList) {
            // Escape if needed
            let escapeCharacter = (character === '\\' || character === '\'') ? '\\' : '';

            // Create the callback function with the correct ascii value in the function body to be called later
            const dynamicFunction = new AsyncFunction('', `await this.sendAsciiToDevice('${escapeCharacter}${character}');`).bind(this);

            // Convert SPACE and TAB so the commands are more readable for the user if the decide to bind them to something different
            character = character === ' ' ? 'SPACE' : character;
            character = character === '\t' ? 'TAB' : character;

            // Register the command
            this.registerCommand('sendAscii+' + character, dynamicFunction);
        }
    }

    public async openFile(filename: string, range: vscode.Range = null, preview = false): Promise<boolean> {
        let uri = vscode.Uri.file(filename);
        try {
            let doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
            await vscode.window.showTextDocument(doc, { preview: preview });
            if (range) {
                await this.gotoRange(range);
            }
        } catch (e) {
            return false;
        }
        return true;
    }

    private async gotoRange(range: vscode.Range) {
        let editor = vscode.window.activeTextEditor;
        editor.selection = new vscode.Selection(
            range.start.line,
            range.start.character,
            range.start.line,
            range.start.character
        );
        await vscode.commands.executeCommand('revealLine', {
            lineNumber: range.start.line,
            at: 'center'
        });
    }

    public async onToggleXml() {
        if (vscode.window.activeTextEditor) {
            const currentDocument = vscode.window.activeTextEditor.document;
            let alternateFileName = this.fileUtils.getAlternateFileName(currentDocument.fileName);
            if (alternateFileName) {
                if (
                    !await this.openFile(alternateFileName) &&
                    alternateFileName.toLowerCase().endsWith('.brs')
                ) {
                    await this.openFile(this.fileUtils.getBsFileName(alternateFileName));
                }
            }
        }
    }

    public async sendRemoteCommand(key: string) {
        await this.getRemoteHost();
        if (this.host) {
            let clickUrl = `http://${this.host}:8060/keypress/${key}`;
            console.log(`send ${clickUrl}`);
            return new Promise((resolve, reject) => {
                request.post(clickUrl, (err, response) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve(response);
                });
            });
        }
    }

    public async getRemoteHost() {
        this.host = await this.context.workspaceState.get('remoteHost');
        if (!this.host) {
            let config = vscode.workspace.getConfiguration('brightscript.remoteControl', null);
            this.host = config.get('host');
            // eslint-disable-next-line no-template-curly-in-string
            if (this.host === '${promptForHost}') {
                this.host = await vscode.window.showInputBox({
                    placeHolder: 'The IP address of your Roku device',
                    value: ''
                });
            }
        }
        if (!this.host) {
            throw new Error('Can\'t send command: host is required.');
        } else {
            await this.context.workspaceState.update('remoteHost', this.host);
        }
        if (this.host) {
            this.host = await rokuDebugUtil.dnsLookup(this.host);
        }
    }

    private registerCommand(name: string, callback: (...args: any[]) => any, thisArg?: any) {
        this.context.subscriptions.push(vscode.commands.registerCommand('extension.brightscript.' + name, callback, thisArg));
    }

    private async sendAsciiToDevice(character: string) {
        let commandToSend: string = 'Lit_' + encodeURIComponent(character);
        await this.sendRemoteCommand(commandToSend);
    }
}

export const brightScriptCommands = new BrightScriptCommands();
