import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "php-interface-definition.goToImplementations",
    async (uri?: vscode.Uri, position?: vscode.Position, methodName?: string) => {
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
      await findImplementations(interfaceName, document, position, methodName);
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

      const interfaceRegex = /interface\s+(\w+)/g;
      let interfaceMatch;

      while ((interfaceMatch = interfaceRegex.exec(text)) !== null) {
        const startPos = document.positionAt(interfaceMatch.index);
        const line = document.lineAt(startPos.line);
        const indexOfName = interfaceMatch[0].indexOf(interfaceMatch[1]);
        const namePos = document.positionAt(interfaceMatch.index + indexOfName);

        const range = new vscode.Range(
          startPos,
          new vscode.Position(startPos.line, line.text.length)
        );

        const command: vscode.Command = {
          title: "$(symbol-interface) Go to Implementation",
          command: "php-interface-definition.goToImplementations",
          arguments: [document.uri, namePos],
        };
        codeLenses.push(new vscode.CodeLens(range, command));
      }

      const methodRegex = /public\s+function\s+(\w+)|function\s+(\w+)/g;
      let methodMatch;
      while ((methodMatch = methodRegex.exec(text)) !== null) {
        const methodName = methodMatch[1] || methodMatch[2];
        const startPos = document.positionAt(methodMatch.index);
        const line = document.lineAt(startPos.line);

        const range = new vscode.Range(
          startPos,
          new vscode.Position(startPos.line, line.text.length)
        );

        const precedingText = text.substring(0, methodMatch.index);
        const lastInterfaceMatch = [...precedingText.matchAll(/interface\s+(\w+)/g)].pop();

        if (lastInterfaceMatch && lastInterfaceMatch.index !== undefined) {
          const interfaceName = lastInterfaceMatch[1];
          const indexOfInterfaceName = lastInterfaceMatch[0].indexOf(interfaceName);
          const interfaceNamePos = document.positionAt(lastInterfaceMatch.index + indexOfInterfaceName);

          const command: vscode.Command = {
            title: "$(symbol-method) Go to Implementation",
            command: "php-interface-definition.goToImplementations",
            arguments: [document.uri, interfaceNamePos, methodName],
          };
          codeLenses.push(new vscode.CodeLens(range, command));
        }
      }

      return codeLenses;
    }
  })();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "php", scheme: "file" }, codeLensProvider)
  );
}

async function findImplementations(
  interfaceName: string,
  document: vscode.TextDocument,
  position: vscode.Position,
  methodName?: string
) {
  const title = methodName
    ? `Searching implementations for ${interfaceName}::${methodName}...`
    : `Searching implementations for ${interfaceName}...`;

  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { match?: any }>();
  quickPick.title = title;
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
        let matchLine = reference.range.start.line;
        let className = match[1];

        if (methodName) {
          const text = doc.getText();
          const methodRegex = new RegExp(`function\\s+\\b${methodName}\\b`, 'g');
          const methodMatches = [...text.matchAll(methodRegex)];

          const classDefOffset = doc.offsetAt(new vscode.Position(matchLine, 0));
          const validMethodMatch = methodMatches.find(match => match.index !== undefined && match.index > classDefOffset);

          if (validMethodMatch && validMethodMatch.index !== undefined) {
            matchLine = doc.positionAt(validMethodMatch.index).line;
          }
        }

        const matchData = {
          uri: reference.uri,
          line: matchLine,
          className: className,
        };

        const isDuplicate = matches.some(
          (match) =>
            match.uri.toString() === matchData.uri.toString() && match.line === matchData.line
        );

        if (!isDuplicate) {
          matches.push(matchData);
          const items = matches.map((match) => ({
            label: match.className,
            description: vscode.workspace.asRelativePath(match.uri),
            match: match,
          }));
          quickPick.items = [...items, searchingItem];
        }
      }
    }

    quickPick.busy = false;
    quickPick.placeholder = "Select an implementation";

    quickPick.items = matches.map((match) => ({
      label: match.className,
      description: vscode.workspace.asRelativePath(match.uri),
      match: match,
    }));

    if (matches.length === 0) {
      quickPick.hide();
      vscode.window.setStatusBarMessage(`No implementations found for ${interfaceName}.`, 3000);
    } else if (matches.length === 1) {
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

export function deactivate() { }
