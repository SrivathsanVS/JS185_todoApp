const SeedData = require("./seed-data");
const deepCopy = require("./deep-copy");
const { sortTodoLists, sortTodos } = require("./sort");
const nextId = require("./next-id");

module.exports = class SessionPersistence {
  constructor(session) {
    this._todoLists = session.todoLists || deepCopy(SeedData);
    session.todoLists = this._todoLists;
  }

  sortedTodos(todoList) {
    let todos = todoList.todos;
    let undone = todos.filter(todo => !todo.done);
    let done = todos.filter(todo => todo.done);
    return deepCopy(sortTodos(undone, done));
  }

  isUniqueConstraintViolation(_error) {
    return false;
  }

  sortedTodoLists() {
    let todoLists = deepCopy(this._todoLists);
    let undone = todoLists.filter(todoList => !this.isDoneTodoList(todoList));
    let done = todoLists.filter(todoList => this.isDoneTodoList(todoList));
    return sortTodoLists(undone, done);
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0  && todoList.todos.every(todo => todo.done);
  }

  _findTodoList(todoListId) {
    return this._todoLists.find(todoList => (todoList.id === todoListId));
  }

  _findTodo(todoList, todoId) {
    return todoList.todos.find(todo => todo.id === todoId);
  }

  loadTodoList(todoListId) {
    return deepCopy(this._findTodoList(todoListId));
  }

  loadTodo(todoListId, todoId) {
    // Find a todo with the indicated ID in the indicated todo list. Returns
    // `undefined` if not found. Note that both `todoListId` and `todoId` must be
    // numeric.
    let todoList = this._findTodoList(todoListId);
    if (!todoList) return undefined;
    console.log("here");
    return deepCopy(this._findTodo(todoList, todoId));
  }

  toggleTodo(todoListId, todoId) {
    let todo = this._findTodo(this._findTodoList(todoListId), todoId);
    if (!todo) return false;
    todo.done = !todo.done;
    return true;
  }

  deleteTodo(todoListId, todoId) {
    let todoList = this._findTodoList(todoListId);
    let todoIndex = todoList.todos.findIndex(todo => (todo.id == todoId));
    if (todoIndex < 0) return false;
    todoList.todos.splice(todoIndex, 1);
    return true;
  }

  markAllDone(todoListId) {
    let todoList = this._findTodoList(todoListId);
    if (!todoList || (todoList.todos.length === 0)) return false;
    console.log("Here");
    todoList.todos.filter(todo => !todo.done).forEach(todo => {
      todo.done = true;
    });
    return true;
  }

  // Does the todo list have any undone todos? Returns true if yes, false if no.
  hasUndoneTodos(todoList) {
    return todoList.todos.some(todo => !todo.done);
  }

  createTodo(todoListId, title) {
    let todoList = this._findTodoList(todoListId);
    if (!todoList) return false;

    todoList.todos.push({
      title,
      id: nextId(),
      done: false,
    });
    
    return true;
  }
};