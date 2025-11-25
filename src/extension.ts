import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "php-interface-definition.goToImplementations",
    async (uri?: vscode.Uri, position?: vscode.Position) => {
      let document: vscode.TextDocument;
      let range: vscode.Range | undefined;

      if (uri && position) {
        document = await vscode.workspace.openTextDocument(uri);
        range = document.getWordRangeAtPosition(position);
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        document = editor.document;
        position = editor.selection.active;
        range = document.getWordRangeAtPosition(position);
      }

      if (!range || !position) {
        vscode.window.showInformationMessage("No interface selected.");
        return;
      }

      const interfaceName = document.getText(range);

      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { match?: any }>();
      quickPick.title = `Searching implementations for ${interfaceName}...`;
      quickPick.placeholder = "Please wait, searching...";
      quickPick.busy = true;
      
      const searchingItem = { label: "$(sync~spin) Searching...", alwaysShow: true };
      quickPick.items = [searchingItem];

      let isClosed = false;
      quickPick.onDidHide(() => {
        isClosed = true;
      });

      quickPick.show();

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected && selected.match) {
          quickPick.hide();
          const match = selected.match;
          const doc = await vscode.workspace.openTextDocument(match.uri);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(match.line, 0, match.line, 0),
          });
        }
      });

      try {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          document.uri,
          position
        );

        if (!references || references.length === 0) {
          quickPick.hide();
          vscode.window.setStatusBarMessage(`No references found for ${interfaceName}.`, 3000);
          return;
        }

        const matches: { uri: vscode.Uri; line: number; className: string }[] = [];
        const regex = new RegExp(
          `class\\s+(\\w+)[^{]*implements\\s+[^{]*\\b${interfaceName}\\b`,
          "i"
        );

        for (const reference of references) {
          if (isClosed) {
            return;
          }

          let doc: vscode.TextDocument;
          try {
            doc = await vscode.workspace.openTextDocument(reference.uri);
          } catch (error) {
            continue;
          }

          const lineText = doc.lineAt(reference.range.start.line).text;
          const match = regex.exec(lineText);

          if (match) {
            const matchData = {
              uri: reference.uri,
              line: reference.range.start.line,
              className: match[1],
            };

            const isDuplicate = matches.some(
              (m) =>
                m.uri.toString() === matchData.uri.toString() && m.line === matchData.line
            );

            if (!isDuplicate) {
              matches.push(matchData);
              const items = matches.map((m) => ({
                label: m.className,
                description: vscode.workspace.asRelativePath(m.uri),
                match: m,
              }));
              quickPick.items = [...items, searchingItem];
            }
          }
        }

        quickPick.busy = false;
        quickPick.placeholder = "Select an implementation";
        
        quickPick.items = matches.map((m) => ({
            label: m.className,
            description: vscode.workspace.asRelativePath(m.uri),
            match: m,
        }));

        if (matches.length === 0) {
          quickPick.hide();
          vscode.window.setStatusBarMessage(`No implementations found for ${interfaceName}.`, 3000);
        } else if (matches.length === 1) {
          // Auto-open if only one result found
          quickPick.hide();
          const match = matches[0];
          const doc = await vscode.workspace.openTextDocument(match.uri);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(match.line, 0, match.line, 0),
          });
        }
      } catch (error) {
        console.error("Error finding implementations:", error);
        quickPick.hide();
        vscode.window.showErrorMessage("Error finding implementations.");
      }
    }
  );

  context.subscriptions.push(disposable);

  const codeLensProvider = new (class implements vscode.CodeLensProvider {
    provideCodeLenses(
      document: vscode.TextDocument,
      token: vscode.CancellationToken
    ): vscode.CodeLens[] {
      const codeLenses: vscode.CodeLens[] = [];
      const text = document.getText();
      const regex = /interface\s+(\w+)/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const startPos = document.positionAt(match.index);
        const line = document.lineAt(startPos.line);
        const indexOfName = match[0].indexOf(match[1]);
        const namePos = document.positionAt(match.index + indexOfName);

        const range = new vscode.Range(
          startPos,
          new vscode.Position(startPos.line, line.text.length)
        );

        const command: vscode.Command = {
          title: "$(symbol-interface) Go to Implementations",
          command: "php-interface-definition.goToImplementations",
          arguments: [document.uri, namePos],
        };
        codeLenses.push(new vscode.CodeLens(range, command));
      }
      return codeLenses;
    }
  })();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "php", scheme: "file" }, codeLensProvider)
  );
}

export function deactivate() {}
