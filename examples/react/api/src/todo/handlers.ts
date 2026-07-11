import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import { EventHandler } from "converge";
import { Effect } from "effect";
import { appendCompletionSet, appendCreated, appendDeleted } from "./versioned-storage.ts";

/**
 * @category event handler
 */
export const todoCreatedHandler = EventHandler.make(todoCreated, appendCreated);

/**
 * @category event handler
 */
export const todoCompletionSetHandler = EventHandler.make(todoCompletionSet, appendCompletionSet);

/**
 * @category event handler
 */
export const todoDeletedHandler = EventHandler.make(todoDeleted, appendDeleted);

export const todoHandlers = [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler];
