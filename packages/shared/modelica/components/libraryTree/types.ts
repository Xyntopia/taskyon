export type ModelicaLibraryTreeNode = {
  id: string
  label: string
  qualifiedName: string
  classType?: string
  children?: ModelicaLibraryTreeNode[]
}
