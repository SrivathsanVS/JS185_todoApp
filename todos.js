const express = require("express");
const morgan = require("morgan");
const flash = require("express-flash");
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const TodoList = require("./lib/todolist");
const Todo = require("./lib/todo");
const { sortTodos } = require("./lib/sort");
const store = require("connect-loki");
const PgPersistence = require("./lib/pg-persistence");
const catchError = require("./lib/catch-error.js");


const app = express();
const host = "localhost";
const port = 3001;
const LokiStore = store(session);

app.set("views", "./views");
app.set("view engine", "pug");

app.use(morgan("common"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000, // 31 days in millseconds
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: "this is not very secure",
  store: new LokiStore({}),
}));

app.use(flash());


// Create a datastore
app.use((req, res, next) => {
  res.locals.store = new PgPersistence(req.session);
  next();
})

// Extract session info
app.use((req, res, next) => {
  res.locals.username = req.session.username;
  res.locals.signedIn = req.session.signedIn;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

// Detect unauthorized access to routes.
const requiresAuthentication = (req, res, next) => {
  if (!res.locals.signedIn) {
    // console.log("Unauthorized.");
    // res.status(401).send("Unauthorized.");
    res.redirect(302, "/users/signin");
  } else {
    next();
  }
};

// Redirect start page
app.get("/", (req, res) => {
  res.redirect("/lists");
});

// Sign In Page
app.get("/users/signin", (req, res) => {
  req.flash('info', 'Please sign in.');
  res.render("signin", {
    flash: req.flash(),
  });
});

// Render the list of todo lists
app.get("/lists",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let store = res.locals.store;
    let todoLists = await store.sortedTodoLists();
    let todosInfo = todoLists.map(todoList => ({
        countAllTodos: todoList.todos.length,
        countDoneTodos: todoList.todos.filter(todo => todo.done).length,
        isDone: store.isDoneTodoList(todoList),
  }));
  
  res.render("lists", {
      todoLists,
      todosInfo,
    });
  }
));

// Render new todo list page
app.get("/lists/new",
  requiresAuthentication,
  (req, res) => {
    res.render("new-list");
});

// Create a new todo list
app.post("/lists",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
      .custom((title, { req }) => {
        let todoLists = req.session.todoLists;
        let duplicate = todoLists.find(list => list.title === title);
        return duplicate === undefined;
      })
      .withMessage("List title must be unique."),
  ],
  catchError(async (req, res) => {
    let errors = validationResult(req);
    let todoListTitle = req.body.todoListTitle;

    const rerenderNewList= () => {
      res.render("new-list", {
        todoListTitle,
        flash: req.flash(),
      });
    };

    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      rerenderNewList();
    } else if (await res.locals.store.existsTodoListTitle(todoListTitle)) {
      req.flash("error", "The list title must be unique");
      rerenderNewList();
    } else {
      let todoListCreated = await res.locals.store.createTodoList(todoListTitle);
      if (!todoListCreated) {
        req.flash("error", "The list title must be unique");
        rerenderNewList();
      } else {
        req.flash("success", "The todo list has been created.");
        res.redirect("/lists");
      }
    }
  }));

// Render individual todo list and its todos
app.get("/lists/:todoListId",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (todoList === undefined) throw new Error("Not found.");
    todoList.todos = await res.locals.store.sortedTodos(todoList);
    res.render("list", {
      todoList,
      isDoneTodoList: res.locals.store.isDoneTodoList(todoList),
      hasUndoneTodos: res.locals.store.hasUndoneTodos(todoList)});
    }
));

// Add the following code just before the Express error handler.

// Handle Sign In form submission
app.post("/users/signin", async (req, res) => {
  let username = req.body.username.trim();
  let password = req.body.password;
  let userAuthenticated = await res.locals.store.authenticateUser(username, password);

  if (!userAuthenticated) {
    req.flash("error", "Invalid credentials.");
    res.render("signin", {
      flash: req.flash(),
      username: req.body.username,
    });
  } else {
    req.session.username = username;
    req.session.signedIn = true;
    req.flash("info", "Welcome!");
    res.redirect("/lists");
  }
});

// Handle Sign Out
app.post("/users/signout", (req, res) => {
  delete req.session.username;
  delete req.session.signedIn;
  res.redirect("/users/signin");
});



// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = req.params;
    let toggled = await res.locals.store.toggleDoneTodo(+todoListId, +todoId);
    if (!toggled) throw new Error("Not found.");

    let todo = await res.locals.store.loadTodo(+todoListId, +todoId);
    if (todo.done) {
      req.flash("success", `"${todo.title}" marked done.`);
    } else {
      req.flash("success", `"${todo.title}" marked as NOT done!`);
    }

    res.redirect(`/lists/${todoListId}`);
  })
);


// Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let { todoListId, todoId } = { ...req.params };
    let store = res.locals.store;
    let todoDeleted = await store.deleteTodo(+todoListId, +todoId);
    if (!todoDeleted) {
      next(new Error("Not found."));
    } else {
      req.flash("success", "The todo has been deleted.");
      res.redirect(`/lists/${todoListId}`);
  }})
);

// Mark all todos as done
app.post("/lists/:todoListId/complete_all",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let store = res.locals.store;
    let markedAllDone = await store.completeAll(+todoListId);
    if (!markedAllDone) {
      next(new Error("Not found."));
    } else {
      req.flash("success", "All todos have been marked as done.");
      res.redirect(`/lists/${todoListId}`);
    }
  }
));

// Create a new todo and add it to the specified list
app.post("/lists/:todoListId/todos",
  requiresAuthentication,
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    let todoTitle = req.body.todoTitle;
    if (!todoList) {
      next(new Error("Not found."));
    } else {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        todoList.todos = res.locals.store.sortedTodos(todoList);
        res.render("list", {
          todoList,
          isDoneTodoList: res.locals.store.isDoneTodoList(todoList),
          hasUndoneTodos: res.locals.store.hasUndoneTodos(todoList),
          todoTitle,
          flash: req.flash(),
        });
      } else {
        let created = await res.locals.store.createTodo(+todoListId, todoTitle);
        if (!created) {
          next(new Error("Not found."));
        } else {
          req.flash("success", "The todo has been created.");
          res.redirect(`/lists/${todoListId}`);
        }
      }
    }
  })
);

// Render edit todo list form
app.get("/lists/:todoListId/edit",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) {
      next(new Error("Not found."));
    } else {
      res.render("edit-list", { todoList });
    }
}));

// Delete todo list
app.post("/lists/:todoListId/destroy",
  requiresAuthentication,
  catchError(async (req, res, next) => {
    let todoListId = +req.params.todoListId;
    let deleteList = await res.locals.store.deleteList(todoListId);
    if (deleteList === -1) {
      next(new Error("Not found."));
    } else {
      req.flash("success", "Todo list deleted.");
      res.redirect("/lists");
    }
  }
));

// Edit todo list title
app.post("/lists/:todoListId/edit",
  requiresAuthentication,
  [
    // omitted code
  ],
  catchError(async (req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let todoListTitle = req.body.todoListTitle;

    const rerenderEditList = async () => {
      let todoList = await store.loadTodoList(+todoListId);
      if (!todoList) throw new Error("Not found.");

      res.render("edit-list", {
        todoListTitle,
        todoList,
        flash: req.flash(),
      });
    };

    try {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        rerenderEditList();
      } else if (await store.existsTodoListTitle(todoListTitle)) {
        req.flash("error", "The list title must be unique.");
        rerenderEditList();
      } else {
        let updated = await store.setTodoListTitle(+todoListId, todoListTitle);
        if (!updated) throw new Error("Not found.");

        req.flash("success", "Todo list updated.");
        res.redirect(`/lists/${todoListId}`);
      }
    } catch (error) {
      if (store.isUniqueConstraintViolation(error)) {
        req.flash("error", "The list title must be unique.");
        rerenderEditList();
      } else {
        throw error;
      }
    }
  })
);

// Error handler
app.use((err, req, res, _next) => {
  console.log(err); // Writes more extensive information to the console log
  res.status(404).send(err.message);
});

// Listener
app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});
