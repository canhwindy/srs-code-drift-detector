/**
 * Barrel export for duplicate checkers
 */

export type { IDuplicateChecker } from './IDuplicateChecker';   //interface — type only, erased at runtime - need "type" keyword
export { FilenameDuplicateChecker } from './FilenameDuplicateChecker';
export { ContentDuplicateChecker } from './ContentDuplicateChecker';
export { CompositeDuplicateChecker } from './CompositeDuplicateChecker';
