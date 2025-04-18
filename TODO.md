TODO:
- [x] rename notes
- [x] rename aliases
    - [ ] give user a choice over what kind of capitalization -- always use caps they entered or copy capitalization of the destination
- [x] handle users adding cells on their own
- [x] handle users editing markdown cells ------- should this be handled at all???
    - should not be handled
- [x] figure out nesting??? -- if four spaces in the start of a line, then make it bullet??
- [x] notebook links rendered in Markdown
- [x] fragment links rendered in Markdown
- [ ] integrate with search bar -- search bar will now be looking inside of jsons which we don't actually want
    - probably can just search in NotebookPanelNotes -- won't have unsaved data but who cares
- [x] anywhere that opens a document needs to open a notebook for this
- [ ] validation
    - [ ] no empty cells
    - [ ] for aliases and note titles, no special characters besides dashes and spaces
- [ ] reload tabs and views makes it so the serializer never gets called again :(((


Later
- [ ] images
- [ ] alter rename to not completely rewrite .config and .wtnote files