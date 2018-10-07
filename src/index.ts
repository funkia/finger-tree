const branchingFactor = 32;
const branchBits = 5;
const mask = 31;

interface Setoid {
  "fantasy-land/equals"(b: any): boolean;
}

function isSetoid(a: any): a is Setoid {
  return a && typeof a["fantasy-land/equals"] === "function";
}

function elementEquals(a: any, b: any): boolean {
  if (a === b) {
    return true;
  } else if (isSetoid(a)) {
    return a["fantasy-land/equals"](b);
  } else {
    return false;
  }
}

function createPath(depth: number, value: any): any {
  let current = value;
  for (let i = 0; i < depth; ++i) {
    current = new Node(undefined, [current]);
  }
  return current;
}

// Array helper functions

function copyArray(source: any[]): any[] {
  const array = [];
  for (let i = 0; i < source.length; ++i) {
    array[i] = source[i];
  }
  return array;
}

function pushElements<A>(
  source: A[],
  target: A[],
  offset: number,
  amount: number
): void {
  for (let i = offset; i < offset + amount; ++i) {
    target.push(source[i]);
  }
}

function copyIndices(
  source: any[],
  sourceStart: number,
  target: any[],
  targetStart: number,
  length: number
): void {
  for (let i = 0; i < length; ++i) {
    target[targetStart + i] = source[sourceStart + i];
  }
}

function arrayPrepend<A>(value: A, array: A[]): A[] {
  const newLength = array.length + 1;
  const result = new Array(newLength);
  result[0] = value;
  for (let i = 1; i < newLength; ++i) {
    result[i] = array[i - 1];
  }
  return result;
}

/**
 * Create a reverse _copy_ of an array.
 */
function reverseArray<A>(array: A[]): A[] {
  return array.slice().reverse();
}

function arrayFirst<A>(array: A[]): A {
  return array[0];
}

function arrayLast<A>(array: A[]): A {
  return array[array.length - 1];
}

const pathResult = { path: 0, index: 0 };
type PathResult = typeof pathResult;

function getPath(
  index: number,
  offset: number,
  depth: number,
  sizes: Sizes
): PathResult {
  const curOffset = (offset >> (depth * branchBits)) & mask;
  let path = ((index >> (depth * branchBits)) & mask) - curOffset;
  if (sizes !== undefined) {
    while (sizes[path] <= index - offset) {
      path++;
    }
    const traversed = path === 0 ? 0 : sizes[path - 1];
    index -= traversed;
  }
  pathResult.path = path;
  pathResult.index = index;
  return pathResult;
}

function updateNode(
  node: Node,
  depth: number,
  index: number,
  offset: number,
  value: any
): Node {
  const { path, index: newIndex } = getPath(index, offset, depth, node.sizes);
  const array = copyArray(node.array);
  array[path] =
    depth > 0
      ? updateNode(
          array[path],
          depth - 1,
          newIndex,
          path === 0 ? offset : 0,
          value
        )
      : value;
  return new Node(node.sizes, array);
}

export type Sizes = number[] | undefined;

/** @private */
export class Node {
  constructor(public sizes: Sizes, public array: any[]) {}
}

function cloneNode({ sizes, array }: Node): Node {
  return new Node(
    sizes === undefined ? undefined : copyArray(sizes),
    copyArray(array)
  );
}

// This array should not be mutated. Thus a dummy element is placed in
// it. Thus the affix will not be owned and thus not mutated.
const emptyAffix: any[] = [0];

// We store a bit field in list. From right to left, the first five
// bits are suffix length, the next five are prefix length and the
// rest is depth. The functions below are for working with the bits in
// a sane way.

const affixBits = 6;
const affixMask = 0b111111;

function getSuffixSize(l: List<any>): number {
  return l.bits & affixMask;
}

function getPrefixSize(l: List<any>): number {
  return (l.bits >> affixBits) & affixMask;
}

function getDepth(l: List<any>): number {
  return l.bits >> (affixBits * 2);
}

function setPrefix(size: number, bits: number): number {
  return (size << affixBits) | (bits & ~(affixMask << affixBits));
}

function setSuffix(size: number, bits: number): number {
  return size | (bits & ~affixMask);
}

function setDepth(depth: number, bits: number): number {
  return (
    (depth << (affixBits * 2)) | (bits & (affixMask | (affixMask << affixBits)))
  );
}

function incrementPrefix(bits: number): number {
  return bits + (1 << affixBits);
}

function incrementSuffix(bits: number): number {
  return bits + 1;
}

function incrementDepth(bits: number): number {
  return bits + (1 << (affixBits * 2));
}

function decrementDepth(bits: number): number {
  return bits - (1 << (affixBits * 2));
}

/*
 * Invariants that any list `l` should satisfy
 *
 * 1. If `l.root !== undefined` then `getSuffixSize(l) !== 0` and
 *    `getPrefixSize(l) !== 0`. The invariant ensures that `first` and
 *    `last` never have to look in the root and that they therefore
 *    take O(1) time.
 * 2. If a tree or sub-tree does not have a size-table then all leaf
 *    nodes in the tree are of size 32.
 */

/**
 * Represents a list of elements.
 */
export class List<A> {
  constructor(
    /** @private */
    readonly bits: number,
    /** @private */
    readonly offset: number,
    /** The number of elements in the list. */
    readonly length: number,
    /** @private */
    readonly prefix: A[],
    /** @private */
    readonly root: Node | undefined,
    /** @private */
    readonly suffix: A[]
  ) {}
  [Symbol.iterator](): Iterator<A> {
    return new ListIterator(this);
  }
}

type MutableList<A> = { -readonly [K in keyof List<A>]: List<A>[K] } & {
  [Symbol.iterator]: () => Iterator<A>;
  // This property doesn't exist at run-time. It exists to prevent a
  // MutableList from being assignable to a List.
  "@@mutable": true;
};

function cloneList<A>(l: List<A>): MutableList<A> {
  return new List(
    l.bits,
    l.offset,
    l.length,
    l.prefix,
    l.root,
    l.suffix
  ) as any;
}

class ListIterator<A> implements Iterator<A> {
  stack: any[][];
  indices: number[];
  idx: number;
  prefixSize: number;
  middleSize: number;
  result: IteratorResult<A> = { done: false, value: undefined as any };
  constructor(private l: List<A>) {
    this.idx = -1;
    this.prefixSize = getPrefixSize(l);
    this.middleSize = l.length - getSuffixSize(l);
    if (l.root !== undefined) {
      const depth = getDepth(l);
      this.stack = new Array(depth + 1);
      this.indices = new Array(depth + 1);
      let currentNode = l.root.array;
      for (let i = depth; 0 <= i; --i) {
        this.stack[i] = currentNode;
        this.indices[i] = 0;
        currentNode = currentNode[0].array;
      }
      this.indices[0] = -1;
    }
  }
  nextInTree(): void {
    let i = 0;
    while (++this.indices[i] === this.stack[i].length) {
      this.indices[i] = 0;
      ++i;
    }
    for (; 0 < i; --i) {
      this.stack[i - 1] = this.stack[i][this.indices[i]].array;
    }
  }
  next(): IteratorResult<A> {
    let newVal;
    const idx = ++this.idx;
    if (idx < this.prefixSize) {
      newVal = this.l.prefix[this.prefixSize - idx - 1];
    } else if (idx < this.middleSize) {
      this.nextInTree();
      newVal = this.stack[0][this.indices[0]];
    } else if (idx < this.l.length) {
      newVal = this.l.suffix[idx - this.middleSize];
    } else {
      this.result.done = true;
    }
    this.result.value = newVal;
    return this.result;
  }
}

function emptyPushable<A>(): MutableList<A> {
  return new List(0, 0, 0, [], undefined, []) as any;
}

/** Appends the value to the list by _mutating_ the list and its content. */
function push<A>(value: A, l: MutableList<A>): MutableList<A> {
  const suffixSize = getSuffixSize(l);
  if (l.length === 0) {
    l.bits = setPrefix(1, l.bits);
    l.prefix = [value];
  } else if (suffixSize < 32) {
    l.bits = incrementSuffix(l.bits);
    l.suffix.push(value);
  } else if (l.root === undefined) {
    l.root = new Node(undefined, l.suffix);
    l.suffix = [value];
    l.bits = setSuffix(1, l.bits);
  } else {
    const newNode = new Node(undefined, l.suffix);
    const index = l.length - 1 - 32 + 1;
    let current = l.root!;
    let depth = getDepth(l);
    l.suffix = [value];
    l.bits = setSuffix(1, l.bits);
    if (index - 1 < branchingFactor ** (depth + 1)) {
      for (; depth >= 0; --depth) {
        const path = (index >> (depth * branchBits)) & mask;
        if (path < current.array.length) {
          current = current.array[path];
        } else {
          current.array.push(createPath(depth - 1, newNode));
          break;
        }
      }
    } else {
      l.bits = incrementDepth(l.bits);
      l.root = new Node(undefined, [l.root, createPath(depth, newNode)]);
    }
  }
  l.length++;
  return l;
}

/**
 * Creates a list of the given elements.
 *
 * @complexity O(n)
 * @category Constructors
 * @example
 * list(0, 1, 2, 3); //=> list(0, 1, 2, 3)
 */
export function list<A>(...elements: A[]): List<A> {
  let l = emptyPushable<A>();
  for (const element of elements) {
    push(element, l);
  }
  return l;
}

/**
 * Creates an empty list.
 *
 * @complexity O(1)
 * @category Constructors
 * @example
 * const emptyList = empty(); //=> list()
 */
export function empty<A = any>(): List<A> {
  return new List(0, 0, 0, emptyAffix, undefined, emptyAffix);
}

/**
 * Takes a single arguments and returns a singleton list that contains it.
 *
 * @complexity O(1)
 * @category Constructors
 * @example
 * of("foo"); //=> list("foo")
 */
export function of<A>(a: A): List<A> {
  return list(a);
}

/**
 * Takes two arguments and returns a list that contains them.
 *
 * @complexity O(1)
 * @category Constructors
 * @example
 * pair("foo", "bar"); //=> list("foo", "bar")
 */
export function pair<A>(first: A, second: A): List<A> {
  return new List(2, 0, 2, emptyAffix, undefined, [first, second]);
}

/**
 * Converts an array, an array-like, or an iterable into a list.
 *
 * @complexity O(n)
 * @category Constructors
 * @example
 * from([0, 1, 2, 3, 4]); //=> list(0, 1, 2, 3, 4)
 * from(new Set([0, 1, 2, 3]); //=> list(0, 1, 2, 3)
 * from("hello"); //=> list("h", "e", "l", "l", "o"));
 */
export function from<A>(sequence: A[] | ArrayLike<A> | Iterable<A>): List<A>;
export function from<A>(sequence: any): List<A> {
  let l = emptyPushable<A>();
  if (sequence.length > 0 && (sequence[0] !== undefined || 0 in sequence)) {
    for (let i = 0; i < sequence.length; ++i) {
      push(sequence[i], l);
    }
  } else if (Symbol.iterator in sequence) {
    const iterator = sequence[Symbol.iterator]();
    let cur;
    // tslint:disable-next-line:no-conditional-assignment
    while (!(cur = iterator.next()).done) {
      push(cur.value, l);
    }
  }
  return l;
}

/**
 * Returns a list of numbers between an inclusive lower bound and an exclusive upper bound.
 *
 * @complexity O(n)
 * @category Constructors
 * @example
 * range(3, 8); //=> list(3, 4, 5, 6, 7)
 */
export function range(start: number, end: number): List<number> {
  let list = emptyPushable<number>();
  for (let i = start; i < end; ++i) {
    push(i, list);
  }
  return list;
}

/**
 * Returns a list of a given length that contains the specified value
 * in all positions.
 *
 * @complexity O(n)
 * @category Constructors
 * @example
 * repeat(1, 7); //=> list(1, 1, 1, 1, 1, 1, 1)
 * repeat("foo", 3); //=> list("foo", "foo", "foo")
 */
export function repeat<A>(value: A, times: number): List<A> {
  let l = emptyPushable<A>();
  while (--times >= 0) {
    push(value, l);
  }
  return l;
}

/**
 * Generates a new list by calling a function with the current index
 * `n` times.
 *
 * @complexity O(n)
 * @category Constructors
 * @example
 * times(i => i, 5); //=> list(0, 1, 2, 3, 4)
 * times(i => i * 2 + 1, 4); //=> list(1, 3, 5, 7)
 * times(() => Math.round(Math.random() * 10), 5); //=> list(9, 1, 4, 3, 4)
 */
export function times<A>(func: (index: number) => A, times: number): List<A> {
  let l = emptyPushable<A>();
  for (let i = 0; i < times; i++) {
    push(func(i), l);
  }
  return l;
}

function nodeNthDense(node: Node, depth: number, index: number): any {
  let current = node;
  for (; depth >= 0; --depth) {
    current = current.array[(index >> (depth * branchBits)) & mask];
  }
  return current;
}

function handleOffset(depth: number, offset: number, index: number): number {
  index += offset;
  for (; depth >= 0; --depth) {
    index = index - (offset & (mask << (depth * branchBits)));
    if (((index >> (depth * branchBits)) & mask) !== 0) {
      break;
    }
  }
  return index;
}

function nodeNth(
  node: Node,
  depth: number,
  offset: number,
  index: number
): any {
  let path;
  let current = node;
  while (current.sizes !== undefined) {
    path = (index >> (depth * branchBits)) & mask;
    while (current.sizes[path] <= index) {
      path++;
    }
    if (path !== 0) {
      index -= current.sizes[path - 1];
      offset = 0; // Offset is discarded if the left spine isn't traversed
    }
    depth--;
    current = current.array[path];
  }
  return nodeNthDense(
    current,
    depth,
    offset === 0 ? index : handleOffset(depth, offset, index)
  );
}

/**
 * Gets the nth element of the list. If `n` is out of bounds
 * `undefined` is returned.
 *
 * @complexity O(log(n))
 * @category Folds
 * @example
 * const l = list(0, 1, 2, 3, 4);
 * nth(2, l); //=> 2
 */
export function nth<A>(index: number, l: List<A>): A | undefined {
  if (index < 0 || l.length <= index) {
    return undefined;
  }
  const prefixSize = getPrefixSize(l);
  const suffixSize = getSuffixSize(l);
  if (index < prefixSize) {
    return l.prefix[prefixSize - index - 1];
  } else if (index >= l.length - suffixSize) {
    return l.suffix[index - (l.length - suffixSize)];
  }
  const { offset } = l;
  const depth = getDepth(l);
  return l.root!.sizes === undefined
    ? nodeNthDense(
        l.root!,
        depth,
        offset === 0
          ? index - prefixSize
          : handleOffset(depth, offset, index - prefixSize)
      )
    : nodeNth(l.root!, depth, offset, index - prefixSize);
}

function setSizes(node: Node, height: number): Node {
  let sum = 0;
  const sizeTable = [];
  for (let i = 0; i < node.array.length; ++i) {
    sum += sizeOfSubtree(node.array[i], height - 1);
    sizeTable[i] = sum;
  }
  node.sizes = sizeTable;
  return node;
}

/**
 * Returns the number of elements stored in the node.
 */
function sizeOfSubtree(node: Node, height: number): number {
  if (height !== 0) {
    if (node.sizes !== undefined) {
      return arrayLast(node.sizes);
    } else {
      // the node is leftwise dense so all all but the last child are full
      const lastSize = sizeOfSubtree(arrayLast(node.array), height - 1);
      return ((node.array.length - 1) << (height * branchBits)) + lastSize;
    }
  } else {
    return node.array.length;
  }
}

// prepend & append

function affixPush<A>(a: A, array: A[], length: number): A[] {
  if (array.length === length) {
    array.push(a);
    return array;
  } else {
    const newArray: A[] = [];
    copyIndices(array, 0, newArray, 0, length);
    newArray.push(a);
    return newArray;
  }
}

/**
 * Prepends an element to the front of a list and returns the new list.
 *
 * @complexity O(1)
 * @category Transformers
 * @example
 * prepend(0, list(1, 2, 3)); //=> list(0, 1, 2, 3)
 * prepend("h", list("e", "l", "l", "o")); //=> list("h", "e", "l", "l", "o")
 */
export function prepend<A>(value: A, l: List<A>): List<A> {
  const prefixSize = getPrefixSize(l);
  if (prefixSize < 32) {
    return new List<A>(
      incrementPrefix(l.bits),
      l.offset,
      l.length + 1,
      affixPush(value, l.prefix, prefixSize),
      l.root,
      l.suffix
    );
  } else {
    const newList = cloneList(l);
    prependNodeToTree(newList, reverseArray(l.prefix));
    const newPrefix = [value];
    newList.prefix = newPrefix;
    newList.length++;
    newList.bits = setPrefix(1, newList.bits);
    return newList;
  }
}

/**
 * Traverses down the left edge of the tree and copies k nodes.
 * Returns the last copied node.
 * @param l
 * @param k The number of nodes to copy. Should always be at least 1.
 */
function copyLeft(l: MutableList<any>, k: number): Node {
  let currentNode = cloneNode(l.root!); // copy root
  l.root = currentNode; // install copy of root

  for (let i = 1; i < k; ++i) {
    const index = 0; // go left
    if (currentNode.sizes !== undefined) {
      for (let i = 0; i < currentNode.sizes.length; ++i) {
        currentNode.sizes[i] += 32;
      }
    }
    const newNode = cloneNode(currentNode.array[index]);
    // Install the copied node
    currentNode.array[index] = newNode;
    currentNode = newNode;
  }
  return currentNode;
}

/**
 * Prepends an element to a node
 */
function nodePrepend(value: any, size: number, node: Node): Node {
  const array = arrayPrepend(value, node.array);
  let sizes = undefined;
  if (node.sizes !== undefined) {
    sizes = new Array(node.sizes.length + 1);
    sizes[0] = size;
    for (let i = 0; i < node.sizes.length; ++i) {
      sizes[i + 1] = node.sizes[i] + size;
    }
  }
  return new Node(sizes, array);
}

/**
 * Prepends a node to a tree. Either by shifting the nodes in the root
 * left or by increasing the height
 */
function prependTopTree<A>(
  l: MutableList<A>,
  depth: number,
  node: Node
): number {
  let newOffset;
  if (l.root!.array.length < branchingFactor) {
    // There is space in the root, there is never a size table in this
    // case
    newOffset = 32 ** depth - 32;
    l.root = new Node(
      undefined,
      arrayPrepend(createPath(depth - 1, node), l.root!.array)
    );
  } else {
    // We need to create a new root
    l.bits = incrementDepth(l.bits);
    const sizes =
      l.root!.sizes === undefined
        ? undefined
        : [32, arrayLast(l.root!.sizes!) + 32];
    newOffset = depth === 0 ? 0 : 32 ** (depth + 1) - 32;
    l.root = new Node(sizes, [createPath(depth, node), l.root]);
  }
  return newOffset;
}

/**
 * Takes a list and a node tail. It then prepends the node to the tree
 * of the list.
 * @param l The subject for prepending. `l` will be mutated. Nodes in
 * the tree will _not_ be mutated.
 * @param node The node that should be prepended to the tree.
 */
function prependNodeToTree<A>(l: MutableList<A>, array: A[]): List<A> {
  if (l.root === undefined) {
    if (getSuffixSize(l) === 0) {
      // ensure invariant 1
      l.bits = setSuffix(array.length, l.bits);
      l.suffix = array;
    } else {
      l.root = new Node(undefined, array);
    }
    return l;
  } else {
    const node = new Node(undefined, array);
    const depth = getDepth(l);
    let newOffset = 0;
    if (l.root.sizes === undefined) {
      if (l.offset !== 0) {
        newOffset = l.offset - branchingFactor;
        l.root = prependDense(l.root, depth, l.offset, node);
      } else {
        // in this case we can be sure that the is not room in the tree
        // for the new node
        newOffset = prependTopTree(l, depth, node);
      }
    } else {
      // represents how many nodes _with size-tables_ that we should copy.
      let copyableCount = 0;
      // go down while there is size tables
      let nodesTraversed = 0;
      let currentNode = l.root;
      while (currentNode.sizes !== undefined && nodesTraversed < depth) {
        ++nodesTraversed;
        if (currentNode.array.length < 32) {
          // there is room if offset is > 0 or if the first node does not
          // contain as many nodes as it possibly can
          copyableCount = nodesTraversed;
        }
        currentNode = currentNode.array[0];
      }
      if (l.offset !== 0) {
        const copiedNode = copyLeft(l, nodesTraversed);
        for (let i = 0; i < copiedNode.sizes!.length; ++i) {
          copiedNode.sizes![i] += branchingFactor;
        }
        copiedNode.array[0] = prependDense(
          copiedNode.array[0],
          depth - nodesTraversed,
          l.offset,
          node
        );
        l.offset = l.offset - branchingFactor;
        return l;
      } else {
        if (copyableCount === 0) {
          l.offset = prependTopTree(l, depth, node);
        } else {
          let parent: Node | undefined;
          let prependableNode: Node;
          // Copy the part of the path with size tables
          if (copyableCount > 1) {
            parent = copyLeft(l, copyableCount - 1);
            prependableNode = parent.array[0];
          } else {
            parent = undefined;
            prependableNode = l.root!;
          }
          const path = createPath(depth - copyableCount, node);
          // add offset
          l.offset = 32 ** (depth - copyableCount + 1) - 32;
          const prepended = nodePrepend(path, 32, prependableNode);
          if (parent === undefined) {
            l.root = prepended;
          } else {
            parent.array[0] = prepended;
          }
        }
        return l;
      }
    }
    l.offset = newOffset;
    return l;
  }
}

/**
 * Prepends a node to a dense tree. The given `offset` is never zero.
 */
function prependDense(
  node: Node,
  depth: number,
  offset: number,
  value: Node
): Node {
  // We're indexing down `offset - 1`. At each step `path` is either 0 or -1.
  const curOffset = (offset >> (depth * branchBits)) & mask;
  const path = (((offset - 1) >> (depth * branchBits)) & mask) - curOffset;
  if (path < 0) {
    return new Node(
      undefined,
      arrayPrepend(createPath(depth - 1, value), node.array)
    );
  } else {
    const array = copyArray(node.array);
    array[0] = prependDense(array[0], depth - 1, offset, value);
    return new Node(undefined, array);
  }
}

/**
 * Appends an element to the end of a list and returns the new list.
 *
 * @complexity O(n)
 * @category Transformers
 * @example
 * append(3, list(0, 1, 2)); //=> list(0, 1, 2, 3)
 */
export function append<A>(value: A, l: List<A>): List<A> {
  const suffixSize = getSuffixSize(l);
  if (suffixSize < 32) {
    return new List(
      incrementSuffix(l.bits),
      l.offset,
      l.length + 1,
      l.prefix,
      l.root,
      affixPush(value, l.suffix, suffixSize)
    );
  }
  const newSuffix = [value];
  const newList = cloneList(l);
  appendNodeToTree(newList, l.suffix);
  newList.suffix = newSuffix;
  newList.length++;
  newList.bits = setSuffix(1, newList.bits);
  return newList;
}

/**
 * Gets the length of a list.
 *
 * @complexity `O(1)`
 * @category Folds
 * @example
 * length(list(0, 1, 2, 3)); //=> 4
 */
export function length(l: List<any>): number {
  return l.length;
}

/**
 * Returns the first element of the list. If the list is empty the
 * function returns undefined.
 *
 * @complexity O(1)
 * @category Folds
 * @example
 * first(list(0, 1, 2, 3)); //=> 0
 * first(list()); //=> undefined
 */
export function first<A>(l: List<A>): A | undefined {
  const prefixSize = getPrefixSize(l);
  return prefixSize !== 0
    ? l.prefix[prefixSize - 1]
    : l.length !== 0
      ? l.suffix[0]
      : undefined;
}

/**
 * Returns the last element of the list. If the list is empty the
 * function returns `undefined`.
 *
 * @complexity O(1)
 * @category Folds
 * @example
 * last(list(0, 1, 2, 3)); //=> 3
 * last(list()); //=> undefined
 */
export function last<A>(l: List<A>): A | undefined {
  const suffixSize = getSuffixSize(l);
  return suffixSize !== 0
    ? l.suffix[suffixSize - 1]
    : l.length !== 0
      ? l.prefix[0]
      : undefined;
}

// map

function mapArray<A, B>(f: (a: A) => B, array: A[]): B[] {
  const result = new Array(array.length);
  for (let i = 0; i < array.length; ++i) {
    result[i] = f(array[i]);
  }
  return result;
}

function mapNode<A, B>(f: (a: A) => B, node: Node, depth: number): Node {
  if (depth !== 0) {
    const { array } = node;
    const result = new Array(array.length);
    for (let i = 0; i < array.length; ++i) {
      result[i] = mapNode(f, array[i], depth - 1);
    }
    return new Node(node.sizes, result);
  } else {
    return new Node(undefined, mapArray(f, node.array));
  }
}

function mapPrefix<A, B>(f: (a: A) => B, prefix: A[], length: number): B[] {
  const newPrefix = new Array(length);
  for (let i = length - 1; 0 <= i; --i) {
    newPrefix[i] = f(prefix[i]);
  }
  return newPrefix;
}

function mapAffix<A, B>(f: (a: A) => B, suffix: A[], length: number): B[] {
  const newSuffix = new Array(length);
  for (let i = 0; i < length; ++i) {
    newSuffix[i] = f(suffix[i]);
  }
  return newSuffix;
}

/**
 * Applies a function to each element in the given list and returns a
 * new list of the values that the function return.
 *
 * @complexity O(n)
 * @category Transformers
 * @example
 * map(n => n * n, list(0, 1, 2, 3, 4)); //=> list(0, 1, 4, 9, 16)
 */
export function map<A, B>(f: (a: A) => B, l: List<A>): List<B> {
  return new List(
    l.bits,
    l.offset,
    l.length,
    mapPrefix(f, l.prefix, getPrefixSize(l)),
    l.root === undefined ? undefined : mapNode(f, l.root, getDepth(l)),
    mapAffix(f, l.suffix, getSuffixSize(l))
  );
}

/**
 * Extracts the specified property from each object in the list.
 *
 * @category Transformers
 * @example
 *
 * const l = list(
 *   { foo: 0, bar: "a" },
 *   { foo: 1, bar: "b" },
 *   { foo: 2, bar: "c" }
 * );
 * pluck("foo", l); //=> list(0, 1, 2)
 * pluck("bar", l); //=> list("a", "b", "c")
 */
export function pluck<A, K extends keyof A>(key: K, l: List<A>): List<A[K]> {
  return map(a => a[key], l);
}

// fold

function foldlSuffix<A, B>(
  f: (acc: B, value: A) => B,
  acc: B,
  array: A[],
  length: number
): B {
  for (let i = 0; i < length; ++i) {
    acc = f(acc, array[i]);
  }
  return acc;
}

function foldlPrefix<A, B>(
  f: (acc: B, value: A) => B,
  acc: B,
  array: A[],
  length: number
): B {
  for (let i = length - 1; 0 <= i; --i) {
    acc = f(acc, array[i]);
  }
  return acc;
}

function foldlNode<A, B>(
  f: (acc: B, value: A) => B,
  acc: B,
  node: Node,
  depth: number
): B {
  const { array } = node;
  if (depth === 0) {
    return foldlSuffix(f, acc, array, array.length);
  }
  for (let i = 0; i < array.length; ++i) {
    acc = foldlNode(f, acc, array[i], depth - 1);
  }
  return acc;
}

/**
 * Folds a function over a list. Left-associative.
 *
 * @category Folds
 * @example
 * foldl((n, m) => n - m, 1, list(2, 3, 4, 5));
 * //=> (((1 - 2) - 3) - 4) - 5 === -13
 */
export function foldl<A, B>(
  f: (acc: B, value: A) => B,
  initial: B,
  l: List<A>
): B {
  const suffixSize = getSuffixSize(l);
  const prefixSize = getPrefixSize(l);
  initial = foldlPrefix(f, initial, l.prefix, prefixSize);
  if (l.root !== undefined) {
    initial = foldlNode(f, initial, l.root, getDepth(l));
  }
  return foldlSuffix(f, initial, l.suffix, suffixSize);
}

/**
 * Alias for [`foldl`](#foldl).
 *
 * @category Folds
 */
export const reduce = foldl;

export interface Of {
  "fantasy-land/of"<B>(a: B): Applicative<B>;
}

export interface Applicative<A> {
  "fantasy-land/map"<B>(f: (a: A) => B): Applicative<B>;
  "fantasy-land/ap"<B>(fa: Applicative<(a: A) => B>): Applicative<B>;
}

/**
 * Map each element of list to an applicative, evaluate these
 * applicatives from left to right, and collect the results.
 *
 * This works with Fantasy Land
 * [applicatives](https://github.com/fantasyland/fantasy-land#applicative).
 *
 * @category Folds
 * @example
 * const l = list(1, 3, 5, 4, 2);
 * L.scan((n, m) => n + m, 0, l); //=> list(0, 1, 4, 9, 13, 15));
 * L.scan((s, m) => s + m.toString(), "", l); //=> list("", "1", "13", "135", "1354", "13542")
 */
export function traverse<A, B>(
  of: Of,
  f: (a: A) => Applicative<B>,
  l: List<A>
): any {
  return foldr(
    (a, fl) =>
      fl["fantasy-land/ap"](
        f(a)["fantasy-land/map"](a => (l: List<any>) => prepend(a, l))
      ),
    of["fantasy-land/of"](empty()),
    l
  );
}

/**
 * Evaluate each applicative in the list from left to right, and and
 * collect the results.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * L.sequence(Maybe, list(just(1), just(2), just(3))); //=> just(list(1, 2, 3))
 * L.sequence(Maybe, list(just(1), just(2), nothing())); //=> nothing
 */
export function sequence<A>(ofObj: Of, l: List<Applicative<A>>): any {
  return traverse(ofObj, a => a, l);
}

/**
 * Folds a function over a list from left to right while collecting
 * all the intermediate steps in a resulting list.
 *
 * @category Transformers
 * @example
 * const l = list(1, 3, 5, 4, 2);
 * L.scan((n, m) => n + m, 0, l); //=> list(0, 1, 4, 9, 13, 15));
 * L.scan((s, m) => s + m.toString(), "", l); //=> list("", "1", "13", "135", "1354", "13542")
 */
export function scan<A, B>(
  f: (acc: B, value: A) => B,
  initial: B,
  l: List<A>
): List<B> {
  return foldl(
    (l2, a) => push(f(last(l2)!, a), l2),
    push(initial, emptyPushable<B>()),
    l
  );
}

/**
 * Invokes a given callback for each element in the list from left to
 * right. Returns `undefined`.
 *
 * This function is very similar to map. It should be used instead of
 * `map` when the mapping function has side-effects. Whereas `map`
 * constructs a new list `forEach` merely returns `undefined`. This
 * makes `forEach` faster when the new list is unneeded.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * const l = list(0, 1, 2);
 * forEach(element => console.log(element)); // Prints 0, then 1, and then 2
 */
export function forEach<A>(callback: (a: A) => void, l: List<A>): void {
  foldl((_, element) => callback(element), undefined as void, l);
}

/**
 * Returns a new list that only contains the elements of the original
 * list for which the predicate returns `true`.
 *
 * @complexity O(n)
 * @category Transformers
 * @example
 * filter(isEven, list(0, 1, 2, 3, 4, 5, 6)); //=> list(0, 2, 4, 6)
 */
export function filter<A, B extends A>(
  predicate: (a: A) => a is B,
  l: List<A>
): List<B>;
export function filter<A>(predicate: (a: A) => boolean, l: List<A>): List<A>;
export function filter<A>(predicate: (a: A) => boolean, l: List<A>): List<A> {
  return foldl(
    (acc, a) => (predicate(a) ? push(a, acc) : acc),
    emptyPushable(),
    l
  );
}

/**
 * Returns a new list that only contains the elements of the original
 * list for which the predicate returns `false`.
 *
 * @complexity O(n)
 * @category Transformers
 * @example
 * reject(isEven, list(0, 1, 2, 3, 4, 5, 6)); //=> list(1, 3, 5)
 */
export function reject<A>(predicate: (a: A) => boolean, l: List<A>): List<A> {
  return foldl(
    (acc, a) => (predicate(a) ? acc : push(a, acc)),
    emptyPushable(),
    l
  );
}

/**
 * Splits the list into two lists. One list that contains all the
 * values for which the predicate returns `true` and one containing
 * the values for which it returns `false`.
 *
 * @complexity O(n)
 * @category Transformers
 * @example
 * partition(isEven, list(0, 1, 2, 3, 4, 5)); //=> [(list(0, 2, 4), list(1, 3, 5)]
 */
export function partition<A, B extends A>(
  predicate: (a: A) => a is B,
  l: List<A>
): [List<B>, List<Exclude<A, B>>];
export function partition<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): [List<A>, List<A>];
export function partition<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): [List<A>, List<A>] {
  return foldl(
    (arr, a) => (predicate(a) ? push(a, arr[0]) : push(a, arr[1]), arr),
    [emptyPushable<A>(), emptyPushable<A>()] as [
      MutableList<A>,
      MutableList<A>
    ],
    l
  );
}

/**
 * Concats the strings in the list separated by a specified separator.
 *
 * @category Folds
 * @example
 * join(", ", list("one", "two", "three")); //=> "one, two, three"
 */
export function join(separator: string, l: List<string>): string {
  return foldl((a, b) => (a.length === 0 ? b : a + separator + b), "", l);
}

function foldrSuffix<A, B>(
  f: (value: A, acc: B) => B,
  initial: B,
  array: A[],
  length: number
): B {
  let acc = initial;
  for (let i = length - 1; 0 <= i; --i) {
    acc = f(array[i], acc);
  }
  return acc;
}

function foldrPrefix<A, B>(
  f: (value: A, acc: B) => B,
  initial: B,
  array: A[],
  length: number
): B {
  let acc = initial;
  for (let i = 0; i < length; ++i) {
    acc = f(array[i], acc);
  }
  return acc;
}

function foldrNode<A, B>(
  f: (value: A, acc: B) => B,
  initial: B,
  { array }: Node,
  depth: number
): B {
  if (depth === 0) {
    return foldrSuffix(f, initial, array, array.length);
  }
  let acc = initial;
  for (let i = array.length - 1; 0 <= i; --i) {
    acc = foldrNode(f, acc, array[i], depth - 1);
  }
  return acc;
}

/**
 * Folds a function over a list. Right-associative.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * foldr((n, m) => n - m, 5, list(1, 2, 3, 4));
 * 1 - (2 - (3 - (4 - 5))); //=> 3
 */
export function foldr<A, B>(
  f: (value: A, acc: B) => B,
  initial: B,
  l: List<A>
): B {
  const suffixSize = getSuffixSize(l);
  const prefixSize = getPrefixSize(l);
  let acc = foldrSuffix(f, initial, l.suffix, suffixSize);
  if (l.root !== undefined) {
    acc = foldrNode(f, acc, l.root, getDepth(l));
  }
  return foldrPrefix(f, acc, l.prefix, prefixSize);
}

/**
 * Alias for [`foldr`](#foldr).
 *
 * @category Folds
 */
export const reduceRight = foldr;

/**
 * Applies a list of functions to a list of values.
 *
 * @category Transformers
 * @example
 * ap(list((n: number) => n + 2, n => 2 * n, n => n * n), list(1, 2, 3));
 * //=> list(3, 4, 5, 2, 4, 6, 1, 4, 9)
 */
export function ap<A, B>(listF: List<(a: A) => B>, l: List<A>): List<B> {
  return flatten(map(f => map(f, l), listF));
}

/**
 * Flattens a list of lists into a list. Note that this function does
 * not flatten recursively. It removes one level of nesting only.
 *
 * @complexity O(n * log(m)), where n is the length of the outer list and m the length of the inner lists.
 * @category Transformers
 * @example
 * const nested = list(list(0, 1, 2, 3), list(4), empty(), list(5, 6));
 * flatten(nested); //=> list(0, 1, 2, 3, 4, 5, 6)
 */
export function flatten<A>(nested: List<List<A>>): List<A> {
  return foldl<List<A>, List<A>>(concat, empty(), nested);
}

/**
 * Maps a function over a list and concatenates all the resulting
 * lists together.
 *
 * @category Transformers
 * @example
 * flatMap(n => list(n, 2 * n, n * n), list(1, 2, 3)); //=> list(1, 2, 1, 2, 4, 4, 3, 6, 9)
 */
export function flatMap<A, B>(f: (a: A) => List<B>, l: List<A>): List<B> {
  return flatten(map(f, l));
}

/**
 * Alias for [`flatMap`](#flatMap).
 * @category Transformers
 */
export const chain = flatMap;

// callback fold

type FoldCb<Input, State> = (input: Input, state: State) => boolean;

function foldlArrayCb<A, B>(
  cb: FoldCb<A, B>,
  state: B,
  array: A[],
  from: number,
  to: number
): boolean {
  for (var i = from; i < to && cb(array[i], state); ++i) {}
  return i === to;
}

function foldrArrayCb<A, B>(
  cb: FoldCb<A, B>,
  state: B,
  array: A[],
  from: number,
  to: number
): boolean {
  for (var i = from - 1; to <= i && cb(array[i], state); --i) {}
  return i === to - 1;
}

function foldlNodeCb<A, B>(
  cb: FoldCb<A, B>,
  state: B,
  node: Node,
  depth: number
): boolean {
  const { array } = node;
  if (depth === 0) {
    return foldlArrayCb(cb, state, array, 0, array.length);
  }
  const to = array.length;
  for (let i = 0; i < to; ++i) {
    if (!foldlNodeCb(cb, state, array[i], depth - 1)) {
      return false;
    }
  }
  return true;
}

/**
 * This function is a lot like a fold. But the reducer function is
 * supposed to mutate its state instead of returning it. Instead of
 * returning a new state it returns a boolean that tells wether or not
 * to continue the fold. `true` indicates that the folding should
 * continue.
 */
function foldlCb<A, B>(cb: FoldCb<A, B>, state: B, l: List<A>): B {
  const prefixSize = getPrefixSize(l);
  if (
    !foldrArrayCb(cb, state, l.prefix, prefixSize, 0) ||
    (l.root !== undefined && !foldlNodeCb(cb, state, l.root, getDepth(l)))
  ) {
    return state;
  }
  const suffixSize = getSuffixSize(l);
  foldlArrayCb(cb, state, l.suffix, 0, suffixSize);
  return state;
}

function foldrNodeCb<A, B>(
  cb: FoldCb<A, B>,
  state: B,
  node: Node,
  depth: number
): boolean {
  const { array } = node;
  if (depth === 0) {
    return foldrArrayCb(cb, state, array, array.length, 0);
  }
  for (let i = array.length - 1; 0 <= i; --i) {
    if (!foldrNodeCb(cb, state, array[i], depth - 1)) {
      return false;
    }
  }
  return true;
}

function foldrCb<A, B>(cb: (a: A, acc: B) => boolean, state: B, l: List<A>): B {
  const suffixSize = getSuffixSize(l);
  const prefixSize = getPrefixSize(l);
  if (
    !foldrArrayCb(cb, state, l.suffix, suffixSize, 0) ||
    (l.root !== undefined && !foldrNodeCb(cb, state, l.root, getDepth(l)))
  ) {
    return state;
  }
  const prefix = l.prefix;
  foldlArrayCb(cb, state, l.prefix, prefix.length - prefixSize, prefix.length);
  return state;
}

// functions based on foldlCb

type PredState = {
  predicate: (a: any) => boolean;
  result: any;
};

function everyCb<A>(value: A, state: any): boolean {
  return (state.result = state.predicate(value));
}

/**
 * Returns `true` if and only if the predicate function returns `true`
 * for all elements in the given list.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * every(isEven, empty()); //=> true
 * every(isEven, list(2, 4, 6, 8)); //=> true
 * every(isEven, list(2, 3, 4, 6, 7, 8)); //=> false
 * every(isEven, list(1, 3, 5, 7)); //=> false
 */
export function every<A>(predicate: (a: A) => boolean, l: List<A>): boolean {
  return foldlCb<A, PredState>(everyCb, { predicate, result: true }, l).result;
}

/**
 * Alias for [`every`](#every).
 *
 * @category Folds
 */
export const all = every;

function someCb<A>(value: A, state: any): boolean {
  return !(state.result = state.predicate(value));
}

/**
 * Returns true if and only if there exists an element in the list for
 * which the predicate returns true.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * const isEven = n => n % 2 === 0;
 * some(isEven, empty()); //=> false
 * some(isEven, list(2, 4, 6, 8)); //=> true
 * some(isEven, list(2, 3, 4, 6, 7, 8)); //=> true
 * some(isEven, list(1, 3, 5, 7)); //=> false
 */
export function some<A>(predicate: (a: A) => boolean, l: List<A>): boolean {
  return foldlCb<A, PredState>(someCb, { predicate, result: false }, l).result;
}

/**
 * Alias for [`some`](#some).
 *
 * @category Folds
 */
// tslint:disable-next-line:variable-name
export const any = some;

/**
 * Returns `true` if and only if the predicate function returns
 * `false` for every element in the given list.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * none(isEven, empty()); //=> true
 * none(isEven, list(2, 4, 6, 8)); //=> false
 * none(isEven, list(2, 3, 4, 6, 7, 8)); //=> false
 * none(isEven, list(1, 3, 5, 7)); //=> true
 */
export function none<A>(predicate: (a: A) => boolean, l: List<A>): boolean {
  return !some(predicate, l);
}

function findCb<A>(value: A, state: PredState): boolean {
  if (state.predicate(value)) {
    state.result = value;
    return false;
  } else {
    return true;
  }
}

/**
 * Returns the _first_ element for which the predicate returns `true`.
 * If no such element is found the function returns `undefined`.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * find(isEven, list(1, 3, 5, 6, 7, 8, 9)); //=> 6
 * find(isEven, list(1, 3, 5, 7, 9)); //=> undefined
 */
export function find<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): A | undefined {
  return foldlCb<A, PredState>(findCb, { predicate, result: undefined }, l)
    .result;
}

/**
 * Returns the _last_ element for which the predicate returns `true`.
 * If no such element is found the function returns `undefined`.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * find(isEven, list(1, 3, 5, 6, 7, 8, 9)); //=> 8
 * find(isEven, list(1, 3, 5, 7, 9)); //=> undefined
 */
export function findLast<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): A | undefined {
  return foldrCb<A, PredState>(findCb, { predicate, result: undefined }, l)
    .result;
}

type IndexOfState = {
  element: any;
  found: boolean;
  index: number;
};

function indexOfCb(value: any, state: IndexOfState): boolean {
  ++state.index;
  return !(state.found = elementEquals(value, state.element));
}

/**
 * Returns the index of the _first_ element in the list that is equal
 * to the given element. If no such element is found `-1` is returned.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * const l = list(12, 4, 2, 89, 6, 18, 7);
 * indexOf(12, l); //=> 0
 * indexOf(89, l); //=> 3
 * indexOf(10, l); //=> -1
 */
export function indexOf<A>(element: A, l: List<A>): number {
  const state = { element, found: false, index: -1 };
  foldlCb(indexOfCb, state, l);
  return state.found ? state.index : -1;
}

/**
 * Returns the index of the _last_ element in the list that is equal
 * to the given element. If no such element is found `-1` is returned.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * const l = L.list(12, 4, 2, 18, 89, 2, 18, 7);
 * L.lastIndexOf(18, l); //=> 6
 * L.lastIndexOf(2, l); //=> 5
 * L.lastIndexOf(12, l); //=> 0
 */
export function lastIndexOf<A>(element: A, l: List<A>): number {
  const state = { element, found: false, index: 0 };
  foldrCb(indexOfCb, state, l);
  return state.found ? l.length - state.index : -1;
}

type FindIndexState = {
  predicate: (a: any) => boolean;
  found: boolean;
  index: number;
};

function findIndexCb<A>(value: A, state: FindIndexState): boolean {
  ++state.index;
  return !(state.found = state.predicate(value));
}

/**
 * Returns the index of the `first` element for which the predicate
 * returns true. If no such element is found the function returns
 * `-1`.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * findIndex(isEven, list(1, 3, 5, 6, 7, 9, 10)); //=> 3
 * findIndex(isEven, list(1, 3, 5, 7, 9)); //=> -1
 */
export function findIndex<A>(predicate: (a: A) => boolean, l: List<A>): number {
  const { found, index } = foldlCb<A, FindIndexState>(
    findIndexCb,
    { predicate, found: false, index: -1 },
    l
  );
  return found ? index : -1;
}

type ContainsState = {
  element: any;
  result: boolean;
};

const containsState: ContainsState = {
  element: undefined,
  result: false
};

function containsCb(value: any, state: ContainsState): boolean {
  return !(state.result = value === state.element);
}

/**
 * Returns `true` if the list contains the specified element.
 * Otherwise it returns `false`.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * includes(3, list(0, 1, 2, 3, 4, 5)); //=> true
 * includes(3, list(0, 1, 2, 4, 5)); //=> false
 */
export function includes<A>(element: A, l: List<A>): boolean {
  containsState.element = element;
  containsState.result = false;
  return foldlCb(containsCb, containsState, l).result;
}

/**
 * Alias for [`includes`](#includes).
 *
 * @category Folds
 */
export const contains = includes;

type EqualsState<A> = {
  iterator: Iterator<A>;
  f: (a: A, b: A) => boolean;
  equals: boolean;
};

function equalsCb<A>(value2: A, state: EqualsState<A>): boolean {
  const { value } = state.iterator.next();
  return (state.equals = state.f(value, value2));
}

/**
 * Returns true if the two lists are equivalent.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * equals(list(0, 1, 2, 3), list(0, 1, 2, 3)); //=> true
 * equals(list("a", "b", "c"), list("a", "z", "c")); //=> false
 */
export function equals<A>(l1: List<A>, l2: List<A>): boolean {
  return equalsWith(elementEquals, l1, l2);
}

/**
 * Returns true if the two lists are equivalent when comparing each
 * pair of elements with the given comparison function.
 *
 * @complexity O(n)
 * @category Folds
 * @example
 * equalsWith(
 *   (n, m) => n.length === m.length,
 *   list("foo", "hello", "one"),
 *   list("bar", "world", "two")
 * ); //=> true
 */
export function equalsWith<A>(
  f: (a: A, b: A) => boolean,
  l1: List<A>,
  l2: List<A>
): boolean {
  if (l1 === l2) {
    return true;
  } else if (l1.length !== l2.length) {
    return false;
  } else {
    const s = { iterator: l2[Symbol.iterator](), equals: true, f };
    return foldlCb<A, EqualsState<A>>(equalsCb, s, l1).equals;
  }
}

// concat

const eMax = 2;

function createConcatPlan(array: Node[]): number[] | undefined {
  const sizes = [];
  let sum = 0;
  for (let i = 0; i < array.length; ++i) {
    sum += array[i].array.length; // FIXME: maybe only access array once
    sizes[i] = array[i].array.length;
  }
  const optimalLength = Math.ceil(sum / branchingFactor);
  let n = array.length;
  let i = 0;
  if (optimalLength + eMax >= n) {
    return undefined; // no rebalancing needed
  }
  while (optimalLength + eMax < n) {
    while (sizes[i] > branchingFactor - eMax / 2) {
      // Skip nodes that are already sufficiently balanced
      ++i;
    }
    // the node at this index is too short
    let remaining = sizes[i]; // number of elements to re-distribute
    do {
      const size = Math.min(remaining + sizes[i + 1], branchingFactor);
      sizes[i] = size;
      remaining = remaining - (size - sizes[i + 1]);
      ++i;
    } while (remaining > 0);
    // Shift nodes after
    for (let j = i; j <= n - 1; ++j) {
      sizes[j] = sizes[j + 1];
    }
    --i;
    --n;
  }
  sizes.length = n;
  return sizes;
}

/**
 * Combines the children of three nodes into an array. The last child
 * of `left` and the first child of `right is ignored as they've been
 * concatenated into `center`.
 */
function concatNodeMerge(
  left: Node | undefined,
  center: Node,
  right: Node | undefined
): Node[] {
  const array = [];
  if (left !== undefined) {
    for (let i = 0; i < left.array.length - 1; ++i) {
      array.push(left.array[i]);
    }
  }
  for (let i = 0; i < center.array.length; ++i) {
    array.push(center.array[i]);
  }
  if (right !== undefined) {
    for (let i = 1; i < right.array.length; ++i) {
      array.push(right.array[i]);
    }
  }
  return array;
}

function executeConcatPlan(
  merged: Node[],
  plan: number[],
  height: number
): any[] {
  const result = [];
  let sourceIdx = 0; // the current node we're copying from
  let offset = 0; // elements in source already used
  for (let toMove of plan) {
    let source = merged[sourceIdx].array;
    if (toMove === source.length && offset === 0) {
      // source matches target exactly, reuse source
      result.push(merged[sourceIdx]);
      ++sourceIdx;
    } else {
      const node = new Node(undefined, []);
      while (toMove > 0) {
        const available = source.length - offset;
        const itemsToCopy = Math.min(toMove, available);
        pushElements(source, node.array, offset, itemsToCopy);
        if (toMove >= available) {
          ++sourceIdx;
          source = merged[sourceIdx].array;
          offset = 0;
        } else {
          offset += itemsToCopy;
        }
        toMove -= itemsToCopy;
      }
      if (height > 1) {
        // Set sizes on children unless they are leaf nodes
        setSizes(node, height - 1);
      }
      result.push(node);
    }
  }
  return result;
}

/**
 * Takes three nodes and returns a new node with the content of the
 * three nodes. Note: The returned node does not have its size table
 * set correctly. The caller must do that.
 */
function rebalance(
  left: Node | undefined,
  center: Node,
  right: Node | undefined,
  height: number,
  top: boolean
): Node {
  const merged = concatNodeMerge(left, center, right);
  const plan = createConcatPlan(merged);
  const balanced =
    plan !== undefined ? executeConcatPlan(merged, plan, height) : merged;
  if (balanced.length <= branchingFactor) {
    if (top === true) {
      return new Node(undefined, balanced);
    } else {
      // Return a single node with extra height for balancing at next
      // level
      return new Node(undefined, [
        setSizes(new Node(undefined, balanced), height)
      ]);
    }
  } else {
    return new Node(undefined, [
      setSizes(new Node(undefined, balanced.slice(0, branchingFactor)), height),
      setSizes(new Node(undefined, balanced.slice(branchingFactor)), height)
    ]);
  }
}

function concatSubTree<A>(
  left: Node,
  lDepth: number,
  right: Node,
  rDepth: number,
  isTop: boolean
): Node {
  if (lDepth > rDepth) {
    const c = concatSubTree(
      arrayLast(left.array),
      lDepth - 1,
      right,
      rDepth,
      false
    );
    return rebalance(left, c, undefined, lDepth, isTop);
  } else if (lDepth < rDepth) {
    const c = concatSubTree(
      left,
      lDepth,
      arrayFirst(right.array),
      rDepth - 1,
      false
    );
    return rebalance(undefined, c, right, rDepth, isTop);
  } else if (lDepth === 0) {
    return new Node(undefined, [left, right]);
  } else {
    const c = concatSubTree<A>(
      arrayLast(left.array),
      lDepth - 1,
      arrayFirst(right.array),
      rDepth - 1,
      false
    );
    return rebalance(left, c, right, lDepth, isTop);
  }
}

function getHeight(node: Node): number {
  if (node.array[0] instanceof Node) {
    return 1 + getHeight(node.array[0]);
  } else {
    return 0;
  }
}

/**
 * Takes a RRB-tree and an affix. It then appends the node to the
 * tree.
 * @param l The subject for appending. `l` will be mutated. Nodes in
 * the tree will _not_ be mutated.
 * @param array The affix that should be appended to the tree.
 */
function appendNodeToTree<A>(l: MutableList<A>, array: A[]): MutableList<A> {
  if (l.root === undefined) {
    // The old list has no content in tree, all content is in affixes
    if (getPrefixSize(l) === 0) {
      l.bits = setPrefix(array.length, l.bits);
      l.prefix = reverseArray(array);
    } else {
      l.root = new Node(undefined, array);
    }
    return l;
  }
  const depth = getDepth(l);
  let index = handleOffset(depth, l.offset, l.length - 1 - getPrefixSize(l));
  let nodesToCopy = 0;
  let nodesVisited = 0;
  let shift = depth * 5;
  let currentNode = l.root;
  if (32 ** (depth + 1) < index) {
    shift = 0; // there is no room
    nodesVisited = depth;
  }
  while (shift > 5) {
    let childIndex: number;
    if (currentNode.sizes === undefined) {
      // does not have size table
      childIndex = (index >> shift) & mask;
      index &= ~(mask << shift); // wipe just used bits
    } else {
      childIndex = currentNode.array.length - 1;
      index -= currentNode.sizes[childIndex - 1];
    }
    nodesVisited++;
    if (childIndex < mask) {
      // we are not going down the far right path, this implies that
      // there is still room in the current node
      nodesToCopy = nodesVisited;
    }
    currentNode = currentNode.array[childIndex];
    if (currentNode === undefined) {
      // This will only happened in a pvec subtree. The index does not
      // exist so we'll have to create a new path from here on.
      nodesToCopy = nodesVisited;
      shift = 5; // Set shift to break out of the while-loop
    }
    shift -= 5;
  }

  if (shift !== 0) {
    nodesVisited++;
    if (currentNode.array.length < branchingFactor) {
      // there is room in the found node
      nodesToCopy = nodesVisited;
    }
  }

  const node = new Node(undefined, array);
  if (nodesToCopy === 0) {
    // there was no room in the found node
    const newPath = nodesVisited === 0 ? node : createPath(nodesVisited, node);
    const newRoot = new Node(undefined, [l.root, newPath]);
    l.root = newRoot;
    l.bits = incrementDepth(l.bits);
  } else {
    const copiedNode = copyFirstK(l, nodesToCopy, array.length);
    copiedNode.array.push(createPath(depth - nodesToCopy, node));
  }
  return l;
}

/**
 * Traverses down the right edge of the tree and copies k nodes.
 * @param oldList
 * @param newList
 * @param k The number of nodes to copy. Will always be at least 1.
 * @param leafSize The number of elements in the leaf that will be inserted.
 */
function copyFirstK(
  newList: MutableList<any>,
  k: number,
  leafSize: number
): Node {
  let currentNode = cloneNode(newList.root!); // copy root
  newList.root = currentNode; // install root

  for (let i = 1; i < k; ++i) {
    const index = currentNode.array.length - 1;
    if (currentNode.sizes !== undefined) {
      currentNode.sizes[index] += leafSize;
    }
    const newNode = cloneNode(currentNode.array[index]);
    // Install the copied node
    currentNode.array[index] = newNode;
    currentNode = newNode;
  }
  if (currentNode.sizes !== undefined) {
    currentNode.sizes.push(arrayLast(currentNode.sizes) + leafSize);
  }
  return currentNode;
}

const concatBuffer = new Array(3);

function concatAffixes<A>(left: List<A>, right: List<A>): number {
  // TODO: Try and find a neat way to reduce the LOC here
  var nr = 0;
  var arrIdx = 0;
  var i = 0;
  var length = getSuffixSize(left);
  concatBuffer[nr] = [];
  for (i = 0; i < length; ++i) {
    concatBuffer[nr][arrIdx++] = left.suffix[i];
  }
  length = getPrefixSize(right);
  for (i = 0; i < length; ++i) {
    if (arrIdx === 32) {
      arrIdx = 0;
      ++nr;
      concatBuffer[nr] = [];
    }
    concatBuffer[nr][arrIdx++] = right.prefix[length - 1 - i];
  }
  length = getSuffixSize(right);
  for (i = 0; i < length; ++i) {
    if (arrIdx === 32) {
      arrIdx = 0;
      ++nr;
      concatBuffer[nr] = [];
    }
    concatBuffer[nr][arrIdx++] = right.suffix[i];
  }
  return nr;
}

/**
 * Concatenates two lists.
 *
 * @complexity O(log(n))
 * @category Transformers
 * @example
 * concat(list(0, 1, 2), list(3, 4)); //=> list(0, 1, 2, 3, 4)
 */
export function concat<A>(left: List<A>, right: List<A>): List<A> {
  if (left.length === 0) {
    return right;
  } else if (right.length === 0) {
    return left;
  }
  const newSize = left.length + right.length;
  const rightSuffixSize = getSuffixSize(right);
  let newList = cloneList(left);
  if (right.root === undefined) {
    // right is nothing but a prefix and a suffix
    const nrOfAffixes = concatAffixes(left, right);
    for (var i = 0; i < nrOfAffixes; ++i) {
      newList = appendNodeToTree(newList, concatBuffer[i]);
      newList.length += concatBuffer[i].length;
      // wipe pointer, otherwise it might end up keeping the array alive
      concatBuffer[i] = undefined;
    }
    newList.length = newSize;
    newList.suffix = concatBuffer[nrOfAffixes];
    newList.bits = setSuffix(concatBuffer[nrOfAffixes].length, newList.bits);
    concatBuffer[nrOfAffixes] = undefined;
    return newList;
  } else {
    const leftSuffixSize = getSuffixSize(left);
    if (leftSuffixSize > 0) {
      newList = appendNodeToTree(newList, left.suffix.slice(0, leftSuffixSize));
      newList.length += leftSuffixSize;
    }
    newList = appendNodeToTree(
      newList,
      right.prefix.slice(0, getPrefixSize(right)).reverse()
    );
    const newNode = concatSubTree(
      newList.root!,
      getDepth(newList),
      right.root,
      getDepth(right),
      true
    );
    const newDepth = getHeight(newNode);
    setSizes(newNode, newDepth);
    newList.root = newNode;
    newList.offset &= ~(mask << (getDepth(left) * branchBits));
    newList.length = newSize;
    newList.bits = setSuffix(rightSuffixSize, setDepth(newDepth, newList.bits));
    newList.suffix = right.suffix;
    return newList;
  }
}

/**
 * Returns a list that has the entry specified by the index replaced with the given value.
 *
 * If the index is out of bounds the given list is returned unchanged.
 *
 * @complexity O(log(n))
 * @category Transformers
 * @example
 * update(2, "X", list("a", "b", "c", "d", "e")); //=> list("a", "b", "X", "d", "e")
 */
export function update<A>(index: number, a: A, l: List<A>): List<A> {
  if (index < 0 || l.length <= index) {
    return l;
  }
  const prefixSize = getPrefixSize(l);
  const suffixSize = getSuffixSize(l);
  const newList = cloneList(l);
  if (index < prefixSize) {
    const newPrefix = copyArray(newList.prefix);
    newPrefix[newPrefix.length - index - 1] = a;
    newList.prefix = newPrefix;
  } else if (index >= l.length - suffixSize) {
    const newSuffix = copyArray(newList.suffix);
    newSuffix[index - (l.length - suffixSize)] = a;
    newList.suffix = newSuffix;
  } else {
    newList.root = updateNode(
      l.root!,
      getDepth(l),
      index - prefixSize + l.offset,
      l.offset,
      a
    );
  }
  return newList;
}

/**
 * Returns a list that has the entry specified by the index replaced with
 * the value returned by applying the function to the value.
 *
 * If the index is out of bounds the given list is
 * returned unchanged.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * adjust(2, inc, list(0, 1, 2, 3, 4, 5)); //=> list(0, 1, 3, 3, 4, 5)
 */
export function adjust<A>(index: number, f: (a: A) => A, l: List<A>): List<A> {
  if (index < 0 || l.length <= index) {
    return l;
  }
  return update(index, f(nth(index, l)!), l);
}

// slice and slice based functions

let newAffix: any[];

// function getBitsForDepth(n: number, depth: number): number {
//   return n & ~(~0 << ((depth + 1) * branchBits));
// }

function sliceNode(
  node: Node,
  index: number,
  depth: number,
  pathLeft: number,
  pathRight: number,
  childLeft: Node | undefined,
  childRight: Node | undefined
): Node {
  let array = node.array.slice(pathLeft, pathRight + 1);
  if (childLeft !== undefined) {
    array[0] = childLeft;
  }
  if (childRight !== undefined) {
    array[array.length - 1] = childRight;
  }
  let sizes = node.sizes;
  if (sizes !== undefined) {
    sizes = sizes.slice(pathLeft, pathRight + 1);
    let slicedOffLeft = pathLeft !== 0 ? node.sizes![pathLeft - 1] : 0;
    if (childLeft !== undefined) {
      // If the left child has been sliced into a new child we need to know
      // how many elements have been removed from the child.
      if (childLeft.sizes !== undefined) {
        // If the left child has a size table we can simply look at that.
        const oldChild: Node = node.array[pathLeft];
        slicedOffLeft +=
          arrayLast(oldChild.sizes!) - arrayLast(childLeft.sizes);
      } else {
        // If the left child does not have a size table we can
        // calculate how many elements have been removed from it by
        // looking at the index. Note that when we slice into a leaf
        // the leaf is moved up as a prefix. Thus slicing, for
        // instance, at index 20 will remove 32 elements from the
        // child. Similarly slicing at index 50 will remove 64
        // elements at slicing at 64 will remove 92 elements.
        slicedOffLeft += ((index - slicedOffLeft) & ~0b011111) + 32;
      }
    }
    for (let i = 0; i < sizes.length; ++i) {
      sizes[i] -= slicedOffLeft;
    }
    if (childRight !== undefined) {
      const slicedOffRight =
        sizeOfSubtree(node.array[pathRight], depth - 1) -
        sizeOfSubtree(childRight, depth - 1);
      sizes[sizes.length - 1] -= slicedOffRight;
    }
  }
  return new Node(sizes, array);
}

let newOffset = 0;

function sliceLeft(
  tree: Node,
  depth: number,
  index: number,
  offset: number,
  top: boolean
): Node | undefined {
  let { path, index: newIndex } = getPath(index, offset, depth, tree.sizes);
  if (depth === 0) {
    newAffix = tree.array.slice(path).reverse();
    // This leaf node is moved up as a suffix so there is nothing here
    // after slicing
    return undefined;
  } else {
    const child = sliceLeft(
      tree.array[path],
      depth - 1,
      newIndex,
      path === 0 ? offset : 0,
      false
    );
    if (child === undefined) {
      // There is nothing in the child after slicing so we don't include it
      ++path;
      if (path === tree.array.length) {
        return undefined;
      }
    }
    // If we've sliced something away and it's not a the root, update offset
    if (tree.sizes === undefined && top === false) {
      newOffset |= (32 - (tree.array.length - path)) << (depth * branchBits);
    }
    return sliceNode(
      tree,
      index,
      depth,
      path,
      tree.array.length - 1,
      child,
      undefined
    );
  }
}

/** Slice elements off of a tree from the right */
function sliceRight(
  node: Node,
  depth: number,
  index: number,
  offset: number
): Node | undefined {
  let { path, index: newIndex } = getPath(index, offset, depth, node.sizes);
  if (depth === 0) {
    newAffix = node.array.slice(0, path + 1);
    // this leaf node is moved up as a suffix so there is nothing here
    // after slicing
    return undefined;
  } else {
    // slice the child, note that we subtract 1 then the radix lookup
    // algorithm can find the last element that we want to include
    // and sliceRight will do a slice that is inclusive on the index.
    const child = sliceRight(
      node.array[path],
      depth - 1,
      newIndex,
      path === 0 ? offset : 0
    );
    if (child === undefined) {
      // there is nothing in the child after slicing so we don't include it
      --path;
      if (path === -1) {
        return undefined;
      }
    }
    // note that we add 1 to the path since we want the slice to be
    // inclusive on the end index. Only at the leaf level do we want
    // to do an exclusive slice.
    let array = node.array.slice(0, path + 1);
    if (child !== undefined) {
      array[array.length - 1] = child;
    }
    let sizes: Sizes | undefined = node.sizes;
    if (sizes !== undefined) {
      sizes = sizes.slice(0, path + 1);
      if (child !== undefined) {
        const slicedOff =
          sizeOfSubtree(node.array[path], depth - 1) -
          sizeOfSubtree(child, depth - 1);
        sizes[sizes.length - 1] -= slicedOff;
      }
    }
    return new Node(sizes, array);
  }
}

function sliceTreeList<A>(
  from: number,
  to: number,
  tree: Node,
  depth: number,
  offset: number,
  l: MutableList<A>
): List<A> {
  const sizes = tree.sizes;
  let { path: pathLeft, index: newFrom } = getPath(from, offset, depth, sizes);
  let { path: pathRight, index: newTo } = getPath(to, offset, depth, sizes);
  if (depth === 0) {
    // we are slicing a piece off a leaf node
    l.prefix = emptyAffix;
    l.suffix = tree.array.slice(pathLeft, pathRight + 1);
    l.root = undefined;
    l.bits = setSuffix(pathRight - pathLeft + 1, 0);
    return l;
  } else if (pathLeft === pathRight) {
    // Both ends are located in the same subtree, this means that we
    // can reduce the height
    l.bits = decrementDepth(l.bits);
    return sliceTreeList(
      newFrom,
      newTo,
      tree.array[pathLeft],
      depth - 1,
      pathLeft === 0 ? offset : 0,
      l
    );
  } else {
    const childRight = sliceRight(tree.array[pathRight], depth - 1, newTo, 0);
    l.bits = setSuffix(newAffix.length, l.bits);
    l.suffix = newAffix;
    if (childRight === undefined) {
      --pathRight;
    }
    newOffset = 0;

    const childLeft = sliceLeft(
      tree.array[pathLeft],
      depth - 1,
      newFrom,
      pathLeft === 0 ? offset : 0,
      pathLeft === pathRight
    );
    l.offset = newOffset;
    l.bits = setPrefix(newAffix.length, l.bits);
    l.prefix = newAffix;

    if (childLeft === undefined) {
      ++pathLeft;
    }
    if (pathLeft >= pathRight) {
      if (pathLeft > pathRight) {
        // This only happens when `pathLeft` originally was equal to
        // `pathRight + 1` and `childLeft === childRight === undefined`.
        // In this case there is no tree left.
        l.bits = setDepth(0, l.bits);
        l.root = undefined;
      } else {
        // Height can be reduced
        l.bits = decrementDepth(l.bits);
        const newRoot =
          childRight !== undefined
            ? childRight
            : childLeft !== undefined
              ? childLeft
              : tree.array[pathLeft];
        l.root = new Node(newRoot.sizes, newRoot.array); // Is this size handling good enough?
      }
    } else {
      l.root = sliceNode(
        tree,
        from,
        depth,
        pathLeft,
        pathRight,
        childLeft,
        childRight
      );
    }
    return l;
  }
}

/**
 * Returns a slice of a list. Elements are removed from the beginning and
 * end. Both the indices can be negative in which case they will count
 * from the right end of the list.
 *
 * @complexity**: `O(log(n))`
 * @category Transformers
 * @example**
 * const l = list(0, 1, 2, 3, 4, 5);
 * slice(1, 4, l); //=> list(1, 2, 3)
 * slice(2, -2, l); //=> list(2, 3)
 */
export function slice<A>(from: number, to: number, l: List<A>): List<A> {
  let { bits, length } = l;

  to = Math.min(length, to);
  // Handle negative indices
  if (from < 0) {
    from = length + from;
  }
  if (to < 0) {
    to = length + to;
  }

  // Should we just return the empty list?
  if (to <= from || to <= 0 || length <= from) {
    return empty();
  }

  // Return list unchanged if we are slicing nothing off
  if (from <= 0 && length <= to) {
    return l;
  }

  const newLength = to - from;
  let prefixSize = getPrefixSize(l);
  const suffixSize = getSuffixSize(l);

  // Both indices lie in the prefix
  if (to <= prefixSize) {
    return new List(
      setPrefix(newLength, 0),
      0,
      newLength,
      l.prefix.slice(prefixSize - to, prefixSize - from),
      undefined,
      emptyAffix
    );
  }

  const suffixStart = length - suffixSize;
  // Both indices lie in the suffix
  if (suffixStart <= from) {
    return new List(
      setSuffix(newLength, 0),
      0,
      newLength,
      emptyAffix,
      undefined,
      l.suffix.slice(from - suffixStart, to - suffixStart)
    );
  }

  const newList = cloneList(l);
  newList.length = newLength;

  // Both indices lie in the tree
  if (prefixSize <= from && to <= suffixStart) {
    sliceTreeList(
      from - prefixSize + l.offset,
      to - prefixSize + l.offset - 1,
      l.root!,
      getDepth(l),
      l.offset,
      newList
    );
    return newList;
  }

  if (0 < from) {
    // we need to slice something off of the left
    if (from < prefixSize) {
      // do a cheap slice by setting prefix length
      bits = setPrefix(prefixSize - from, bits);
    } else {
      // if we're here `to` can't lie in the tree, so we can set the
      // root
      newOffset = 0;
      newList.root = sliceLeft(
        newList.root!,
        getDepth(l),
        from - prefixSize,
        l.offset,
        true
      );
      newList.offset = newOffset;
      if (newList.root === undefined) {
        bits = setDepth(0, bits);
      }
      bits = setPrefix(newAffix.length, bits);
      prefixSize = newAffix.length;
      newList.prefix = newAffix;
    }
  }
  if (to < length) {
    // we need to slice something off of the right
    if (length - to < suffixSize) {
      bits = setSuffix(suffixSize - (length - to), bits);
    } else {
      newList.root = sliceRight(
        newList.root!,
        getDepth(l),
        to - prefixSize + newList.offset - 1,
        newList.offset
      );
      if (newList.root === undefined) {
        bits = setDepth(0, bits);
        newList.offset = 0;
      }
      bits = setSuffix(newAffix.length, bits);
      newList.suffix = newAffix;
    }
  }
  newList.bits = bits;
  return newList;
}

/**
 * Takes the first `n` elements from a list and returns them in a new list.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * take(3, list(0, 1, 2, 3, 4, 5)); //=> list(0, 1, 2)
 */
export function take<A>(n: number, l: List<A>): List<A> {
  return slice(0, n, l);
}

type FindNotIndexState = {
  predicate: (a: any) => boolean;
  index: number;
};

function findNotIndexCb(value: any, state: FindNotIndexState): boolean {
  if (state.predicate(value)) {
    ++state.index;
    return true;
  } else {
    return false;
  }
}

/**
 * Takes the first elements in the list for which the predicate returns
 * `true`.
 *
 * @complexity `O(k + log(n))` where `k` is the number of elements satisfying
 * the predicate.
 * @category Transformers
 * @example
 * takeWhile(n => n < 4, list(0, 1, 2, 3, 4, 5, 6)); //=> list(0, 1, 2, 3)
 * takeWhile(_ => false, list(0, 1, 2, 3, 4, 5)); //=> list()
 */
export function takeWhile<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): List<A> {
  const { index } = foldlCb(findNotIndexCb, { predicate, index: 0 }, l);
  return slice(0, index, l);
}

/**
 * Takes the last elements in the list for which the predicate returns
 * `true`.
 *
 * @complexity `O(k + log(n))` where `k` is the number of elements
 * satisfying the predicate.
 * @category Transformers
 * @example
 * takeLastWhile(n => n > 2, list(0, 1, 2, 3, 4, 5)); //=> list(3, 4, 5)
 * takeLastWhile(_ => false, list(0, 1, 2, 3, 4, 5)); //=> list()
 */
export function takeLastWhile<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): List<A> {
  const { index } = foldrCb(findNotIndexCb, { predicate, index: 0 }, l);
  return slice(l.length - index, l.length, l);
}

/**
 * Removes the first elements in the list for which the predicate returns
 * `true`.
 *
 * @complexity `O(k + log(n))` where `k` is the number of elements
 * satisfying the predicate.
 * @category Transformers
 * @example
 * dropWhile(n => n < 4, list(0, 1, 2, 3, 4, 5, 6)); //=> list(4, 5, 6)
 */
export function dropWhile<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): List<A> {
  const { index } = foldlCb(findNotIndexCb, { predicate, index: 0 }, l);
  return slice(index, l.length, l);
}

/**
 * Returns a new list without repeated elements.
 *
 * @complexity `O(n)`
 * @category Transformers
 * @example
 * dropRepeats(L.list(0, 0, 1, 1, 1, 2, 3, 3, 4, 4)); //=> list(0, 1, 2, 3, 4)
 */
export function dropRepeats<A>(l: List<A>): List<A> {
  return dropRepeatsWith(elementEquals, l);
}

/**
 * Returns a new list without repeated elements by using the given
 * function to determine when elements are equal.
 *
 * @complexity `O(n)`
 * @category Transformers
 * @example
 *
 * dropRepeatsWith(
 *   (n, m) => Math.floor(n) === Math.floor(m),
 *   list(0, 0.4, 1.2, 1.1, 1.8, 2.2, 3.8, 3.4, 4.7, 4.2)
 * ); //=> list(0, 1, 2, 3, 4)
 */
export function dropRepeatsWith<A>(
  predicate: (a: A, b: A) => Boolean,
  l: List<A>
): List<A> {
  return foldl(
    (acc, a) =>
      acc.length !== 0 && predicate(last(acc)!, a) ? acc : push(a, acc),
    emptyPushable(),
    l
  );
}

/**
 * Takes the last `n` elements from a list and returns them in a new
 * list.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * takeLast(3, list(0, 1, 2, 3, 4, 5)); //=> list(3, 4, 5)
 */
export function takeLast<A>(n: number, l: List<A>): List<A> {
  return slice(l.length - n, l.length, l);
}

/**
 * Splits a list at the given index and return the two sides in a pair.
 * The left side will contain all elements before but not including the
 * element at the given index. The right side contains the element at the
 * index and all elements after it.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * const l = list(0, 1, 2, 3, 4, 5, 6, 7, 8);
 * splitAt(4, l); //=> [list(0, 1, 2, 3), list(4, 5, 6, 7, 8)]
 */
export function splitAt<A>(index: number, l: List<A>): [List<A>, List<A>] {
  return [slice(0, index, l), slice(index, l.length, l)];
}

/**
 * Splits a list at the first element in the list for which the given
 * predicate returns `true`.
 *
 * @complexity `O(n)`
 * @category Transformers
 * @example
 * const l = list(0, 1, 2, 3, 4, 5, 6, 7);
 * splitWhen((n) => n > 3, l); //=> [list(0, 1, 2, 3), list(4, 5, 6, 7)]
 */
export function splitWhen<A>(
  predicate: (a: A) => boolean,
  l: List<A>
): [List<A>, List<A>] {
  const idx = findIndex(predicate, l);
  return idx === -1 ? [l, empty()] : splitAt(idx, l);
}

/**
 * Splits the list into chunks of the given size.
 *
 * @category Transformers
 * @example
 * splitEvery(2, list(0, 1, 2, 3, 4)); //=> list(list(0, 1), list(2, 3), list(4))
 */
export function splitEvery<A>(size: number, l: List<A>): List<List<A>> {
  const { l2, buffer } = foldl(
    ({ l2, buffer }, elm) => {
      push(elm, buffer);
      if (buffer.length === size) {
        return { l2: push(buffer, l2), buffer: emptyPushable<A>() };
      } else {
        return { l2, buffer };
      }
    },
    { l2: emptyPushable<List<A>>(), buffer: emptyPushable<A>() },
    l
  );
  return buffer.length === 0 ? l2 : push(buffer, l2);
}

/**
 * Takes an index, a number of elements to remove and a list. Returns a
 * new list with the given amount of elements removed from the specified
 * index.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * const l = list(0, 1, 2, 3, 4, 5, 6, 7, 8);
 * remove(4, 3, l); //=> list(0, 1, 2, 3, 7, 8)
 * remove(2, 5, l); //=> list(0, 1, 7, 8)
 */
export function remove<A>(from: number, amount: number, l: List<A>): List<A> {
  return concat(slice(0, from, l), slice(from + amount, l.length, l));
}

/**
 * Returns a new list without the first `n` elements.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * drop(2, list(0, 1, 2, 3, 4, 5)); //=> list(2, 3, 4, 5)
 */
export function drop<A>(n: number, l: List<A>): List<A> {
  return slice(n, l.length, l);
}

/**
 * Returns a new list without the last `n` elements.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * dropLast(2, list(0, 1, 2, 3, 4, 5)); //=> list(0, 1, 2, 3)
 */
export function dropLast<A>(n: number, l: List<A>): List<A> {
  return slice(0, l.length - n, l);
}

/**
 * Returns a new list with the last element removed. If the list is
 * empty the empty list is returned.
 *
 * @complexity `O(1)`
 * @category Transformers
 * @example
 * pop(list(0, 1, 2, 3)); //=> list(0, 1, 2)
 */
export function pop<A>(l: List<A>): List<A> {
  return slice(0, -1, l);
}

/**
 * Alias for [`pop`](#pop).
 *
 * @category Transformers
 */
export const init = pop;

/**
 * Returns a new list with the first element removed. If the list is
 * empty the empty list is returned.
 *
 * @complexity `O(1)`
 * @category Transformers
 * @example
 * tail(list(0, 1, 2, 3)); //=> list(1, 2, 3)
 * tail(empty()); //=> list()
 */
export function tail<A>(l: List<A>): List<A> {
  return slice(1, l.length, l);
}

function arrayPush<A>(array: A[], a: A): A[] {
  array.push(a);
  return array;
}

/**
 * Converts a list into an array.
 *
 * @complexity `O(n)`
 * @category Folds
 * @example
 * toArray(list(0, 1, 2, 3, 4)); //=> [0, 1, 2, 3, 4]
 */
export function toArray<A>(l: List<A>): A[] {
  return foldl<A, A[]>(arrayPush, [], l);
}

/**
 * Inserts the given element at the given index in the list.
 *
 * @complexity O(log(n))
 * @category Transformers
 * @example
 * insert(2, "c", list("a", "b", "d", "e")); //=> list("a", "b", "c", "d", "e")
 */
export function insert<A>(index: number, element: A, l: List<A>): List<A> {
  return concat(append(element, slice(0, index, l)), slice(index, l.length, l));
}

/**
 * Inserts the given list of elements at the given index in the list.
 *
 * @complexity `O(log(n))`
 * @category Transformers
 * @example
 * insertAll(2, list("c", "d"), list("a", "b", "e", "f")); //=> list("a", "b", "c", "d", "e", "f")
 */
export function insertAll<A>(
  index: number,
  elements: List<A>,
  l: List<A>
): List<A> {
  return concat(
    concat(slice(0, index, l), elements),
    slice(index, l.length, l)
  );
}

/**
 * Reverses a list.
 * @category Transformers
 * @complexity O(n)
 * @example
 * reverse(list(0, 1, 2, 3, 4, 5)); //=> list(5, 4, 3, 2, 1, 0)
 */
export function reverse<A>(l: List<A>): List<A> {
  return foldl((newL, element) => prepend(element, newL), empty(), l);
}

/**
 * Returns `true` if the given argument is a list and `false`
 * otherwise.
 *
 * @complexity O(1)
 * @category Folds
 * @example
 * isList(list(0, 1, 2)); //=> true
 * isList([0, 1, 2]); //=> false
 * isList("string"); //=> false
 * isList({ foo: 0, bar: 1 }); //=> false
 */
export function isList<A>(l: any): l is List<A> {
  return typeof l === "object" && Array.isArray(l.suffix);
}

/**
 * Iterate over two lists in parallel and collect the pairs.
 *
 * @complexity `O(log(n))`, where `n` is the length of the smallest
 * list.
 *
 * @category Transformers
 * @example
 * const names = list("a", "b", "c", "d", "e");
 * const years = list(0, 1, 2, 3, 4, 5, 6);
 * //=> list(["a", 0], ["b", 1], ["c", 2], ["d", 3], ["e", 4]);
 */
export function zip<A, B>(as: List<A>, bs: List<B>): List<[A, B]> {
  return zipWith((a, b) => [a, b] as [A, B], as, bs);
}

/**
 * This is like mapping over two lists at the same time. The two lists
 * are iterated over in parallel and each pair of elements is passed
 * to the function. The returned values are assembled into a new list.
 *
 * The shortest list determines the size of the result.
 *
 * @complexity `O(log(n))` where `n` is the length of the smallest
 * list.
 * @category Transformers
 * @example
 * const names = list("Turing", "Curry");
 * const years = list(1912, 1900);
 * zipWith((name, year) => ({ name, year }), names, years);
 * //=> list({ name: "Turing", year: 1912 }, { name: "Curry", year: 1900 });
 */
export function zipWith<A, B, C>(
  f: (a: A, b: B) => C,
  as: List<A>,
  bs: List<B>
): List<C> {
  const swapped = bs.length < as.length;
  const iterator = (swapped ? as : bs)[Symbol.iterator]();
  return map(
    (a: any) => {
      const b: any = iterator.next().value;
      return swapped ? f(b, a) : f(a, b);
    },
    (swapped ? bs : as) as any
  );
}

function isPrimitive(value: any): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

export type Ordering = -1 | 0 | 1;

function comparePrimitive<A extends number | string>(a: A, b: A): Ordering {
  return a === b ? 0 : a < b ? -1 : 1;
}

export interface Ord {
  "fantasy-land/lte"(b: any): boolean;
}

export type Comparable = number | string | Ord;

const ord = "fantasy-land/lte";

function compareOrd(a: Ord, b: Ord): Ordering {
  return a[ord](b) ? (b[ord](a) ? 0 : -1) : 1;
}

/**
 * Sorts the given list. The list should contain values that can be
 * compared using the `<` operator or values that implement the
 * Fantasy Land [Ord](https://github.com/fantasyland/fantasy-land#ord)
 * specification.
 *
 * Performs a stable sort.
 *
 * @complexity O(n * log(n))
 * @category Transformers
 * @example
 * sort(list(5, 3, 1, 8, 2)); //=> list(1, 2, 3, 5, 8)
 * sort(list("e", "a", "c", "b", "d"); //=> list("a", "b", "c", "d", "e")
 */
export function sort<A extends Comparable>(l: List<A>): List<A> {
  if (l.length === 0) {
    return l;
  } else if (isPrimitive(first(l))) {
    return from(toArray(l).sort(comparePrimitive as any));
  } else {
    return sortWith(compareOrd, l as any) as any;
  }
}

/**
 * Sort the given list by comparing values using the given function.
 * The function receieves two values and should return `-1` if the
 * first value is stricty larger than the second, `0` is they are
 * equal and `1` if the first values is strictly smaller than the
 * second.
 *
 * Note that the comparison function is equivalent to the one required
 * by
 * [`Array.prototype.sort`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort).
 *
 * Performs a stable sort.
 *
 * @complexity O(n * log(n))
 * @category Transformers
 * @example
 *
 * sortWith((a, b) => {
 *   if (a === b) {
 *     return 0;
 *   } else if (a < b) {
 *     return -1;
 *   } else {
 *     return 1;
 *   }
 * }, list(5, 3, 1, 8, 2)); //=> list(1, 2, 3, 5, 8)
 */
export function sortWith<A>(
  comparator: (a: A, b: A) => Ordering,
  l: List<A>
): List<A> {
  const arr: { idx: number; elm: A }[] = [];
  let i = 0;
  forEach(elm => arr.push({ idx: i++, elm }), l);
  arr.sort(({ elm: a, idx: i }, { elm: b, idx: j }) => {
    const c = comparator(a, b);
    return c !== 0 ? c : i < j ? -1 : 1;
  });
  let newL = emptyPushable<A>();
  for (let i = 0; i < arr.length; ++i) {
    push(arr[i].elm, newL);
  }
  return newL;
}

/**
 * Sort the given list by passing each value through the function and
 * comparing the resulting value. The function should either return
 * values comparable using `<` or values that implement the Fantasy
 * Land [Ord](https://github.com/fantasyland/fantasy-land#ord)
 * specification.
 *
 * Performs a stable sort.
 *
 * @complexity O(n * log(n))
 * @category Transformers
 * @example
 *
 * sortBy(
 *   o => o.n,
 *   list({ n: 4, m: "foo" }, { n: 3, m: "bar" }, { n: 1, m: "baz" })
 * ); //=> list({ n: 1, m: "baz" }, { n: 3, m: "bar" }, { n: 4, m: "foo" })
 *
 * sortBy(s => s.length, list("foo", "bar", "ba", "aa", "list", "z"));
 * //=> list("z", "ba", "aa", "foo", "bar", "list")
 */
export function sortBy<A, B extends Comparable>(
  f: (a: A) => B,
  l: List<A>
): List<A> {
  if (l.length === 0) {
    return l;
  }
  const arr: { elm: A; prop: B; idx: number }[] = [];
  let i = 0;
  forEach(elm => arr.push({ idx: i++, elm, prop: f(elm) }), l);
  const comparator: any = isPrimitive(arr[0].prop)
    ? comparePrimitive
    : compareOrd;
  arr.sort(({ prop: a, idx: i }, { prop: b, idx: j }) => {
    const c = comparator(a, b);
    return c !== 0 ? c : i < j ? -1 : 1;
  });
  let newL = emptyPushable<A>();
  for (let i = 0; i < arr.length; ++i) {
    push(arr[i].elm, newL);
  }
  return newL;
}

/**
 * Returns a list of lists where each sublist's elements are all
 * equal.
 *
 * @category Transformers
 * @example
 * group(list(0, 0, 1, 2, 2, 2, 3, 3)); //=> list(list(0, 0), list(1), list(2, 2, 2), list(3, 3))
 */
export function group<A>(l: List<A>): List<List<A>> {
  return groupWith(elementEquals, l);
}

/**
 * Returns a list of lists where each sublist's elements are pairwise
 * equal based on the given comparison function.
 *
 * Note that only adjacent elements are compared for equality. If all
 * equal elements should be grouped together the list should be sorted
 * before grouping.
 *
 * @category Transformers
 * @example
 * const floorEqual = (a, b) => Math.round(a) === Math.round(b);
 * groupWith(floorEqual, list(1.1, 1.3, 1.8, 2, 2.2, 3.3, 3.4));
 * //=> list(list(1.1, 1.3), list(1.8, 2, 2.2), list(3.3, 3.4))
 *
 * const sameLength = (a, b) => a.length === b.length;
 * groupWith(sameLength, list("foo", "bar", "ab", "bc", "baz"));
 * //=> list(list("foo", "bar"), list("ab", "bc"), list("baz))
 */
export function groupWith<A>(
  f: (a: A, b: A) => boolean,
  l: List<A>
): List<List<A>> {
  const result = emptyPushable<MutableList<A>>();
  let buffer = emptyPushable<A>();
  forEach(a => {
    if (buffer.length !== 0 && !f(last(buffer)!, a)) {
      push(buffer, result);
      buffer = emptyPushable();
    }
    push(a, buffer);
  }, l);
  return buffer.length === 0 ? result : push(buffer, result);
}

/**
 * Inserts a separator between each element in a list.
 *
 * @category Transformers
 * @example
 * intersperse("n", list("ba", "a", "a")); //=> list("ba", "n", "a", "n", "a")
 */
export function intersperse<A>(separator: A, l: List<A>): List<A> {
  return pop(
    foldl((l2, a) => push(separator, push(a, l2)), emptyPushable(), l)
  );
}

/**
 * Returns `true` if the given list is empty and `false` otherwise.
 *
 * @category Folds
 * @example
 * isEmpty(list()); //=> true
 * isEmpty(list(0, 1, 2)); //=> false
 */
export function isEmpty(l: List<any>): boolean {
  return l.length === 0;
}
