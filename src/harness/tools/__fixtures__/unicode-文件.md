# Unicode filename

The filename contains Chinese characters (文件 = "file"). Tests
that Node's fs APIs and the tool wrappers handle non-ASCII
filenames without mangling them.
