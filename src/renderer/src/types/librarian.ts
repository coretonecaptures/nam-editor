export interface FolderNode {
  name: string        // display name (last path segment)
  path: string        // absolute path, forward-slash normalized
  children: FolderNode[]
  fileCount: number   // .nam files directly in this folder
  totalCount: number  // .nam files in this folder + all descendants
}

export interface LibrarianState {
  rootFolder: string | null
  folderTree: FolderNode | null
  selectedFolder: string | null  // null = root = show everything
}
