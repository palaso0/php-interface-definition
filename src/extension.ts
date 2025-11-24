
import * as vscode from 'vscode';


export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "php-interface-definition" is now active!');

	const disposable = vscode.commands.registerCommand('php-interface-definition.goToImplementations', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const document = editor.document;
		const position = editor.selection.active;
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			vscode.window.showInformationMessage('No interface selected.');
			return;
		}

		const interfaceName = document.getText(wordRange);

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Searching for implementations of ${interfaceName}...`,
			cancellable: true
		}, async (progress, token) => {
			
			try {
				const references = await vscode.commands.executeCommand<vscode.Location[]>(
					'vscode.executeReferenceProvider',
					document.uri,
					position
				);

				if (!references || references.length === 0) {
					vscode.window.showInformationMessage(`No references found for ${interfaceName}.`);
					return;
				}

				const matches: { uri: vscode.Uri; line: number; className: string }[] = [];
				const regex = new RegExp(`class\\s+(\\w+)[^{]*implements\\s+[^{]*\\b${interfaceName}\\b`, 'i');

				for (const ref of references) {
					if (token.isCancellationRequested) {
						break;
					}


					let doc: vscode.TextDocument;
					try {
						doc = await vscode.workspace.openTextDocument(ref.uri);
					} catch (e) {
						continue;
					}

					const lineText = doc.lineAt(ref.range.start.line).text;
					const match = regex.exec(lineText);

					if (match) {
						matches.push({
							uri: ref.uri,
							line: ref.range.start.line,
							className: match[1]
						});
					}
				}

				if (matches.length === 0) {
					vscode.window.showInformationMessage(`No implementations found for ${interfaceName}.`);
				} else if (matches.length === 1) {
					const match = matches[0];
					const doc = await vscode.workspace.openTextDocument(match.uri);
					await vscode.window.showTextDocument(doc, { selection: new vscode.Range(match.line, 0, match.line, 0) });
				} else {

					const uniqueMatches = matches.filter((v, i, a) => a.findIndex(t => t.uri.toString() === v.uri.toString() && t.line === v.line) === i);

					const items = uniqueMatches.map(m => ({
						label: m.className,
						description: vscode.workspace.asRelativePath(m.uri),
						match: m
					}));

					const selected = await vscode.window.showQuickPick(items, {
						placeHolder: `Select implementation of ${interfaceName}`
					});

					if (selected) {
						const match = selected.match;
						const doc = await vscode.workspace.openTextDocument(match.uri);
						await vscode.window.showTextDocument(doc, { selection: new vscode.Range(match.line, 0, match.line, 0) });
					}
				}

			} catch (err) {
				console.error('Error finding implementations:', err);
				vscode.window.showErrorMessage('Error finding implementations.');
			}
		});
	});

	context.subscriptions.push(disposable);


	vscode.window.onDidChangeTextEditorSelection(event => {
		const editor = event.textEditor;
		if (editor.document.languageId !== 'php') {
			return;
		}

		const position = editor.selection.active;
		const wordRange = editor.document.getWordRangeAtPosition(position);
		
		let isValid = false;
		if (wordRange) {
			const word = editor.document.getText(wordRange);

			if (/^[A-Z]/.test(word)) {
				isValid = true;
			}
		}

		vscode.commands.executeCommand('setContext', 'php-interface-definition.isValidSymbol', isValid);
	}, null, context.subscriptions);
}


export function deactivate() {}
