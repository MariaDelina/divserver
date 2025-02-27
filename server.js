const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de CORS
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5175"],
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// Configuración de la base de datos
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) throw err;
  console.log("🔥 Conectado a MySQL");
});

// Middleware para autenticación
const authenticateAdmin = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
};

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Ruta de login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, results) => {
    if (err) return res.status(500).json({ message: "Error en la base de datos" });

    if (results.length > 0) {
      const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: "1h" });
      res.json({ message: "Autenticación exitosa", token });
    } else {
      res.status(401).json({ message: "Credenciales incorrectas" });
    }
  });
});

// 🟢 RUTAS DE COMENTARIOS

// Agregar un comentario (Estado: pending)
app.post("/comments", (req, res) => {
  const { author, email, content, article_id } = req.body;
  if (!author || !email || !content || !article_id)
    return res.status(400).json({ error: "Faltan campos requeridos" });

  const status = "pending";
  const created_at = new Date().toISOString().slice(0, 19).replace("T", " ");

  const sql = `INSERT INTO comments (author, email, content, status, created_at, article_id) VALUES (?, ?, ?, ?, ?, ?)`;
  db.query(sql, [author, email, content, status, created_at, article_id], (err, result) => {
    if (err) return res.status(500).json({ error: "Error interno del servidor" });

    res.status(201).json({ id: result.insertId, author, email, content, status, created_at, article_id });
  });
});

// Obtener solo comentarios aprobados por artículo
app.get("/comments", (req, res) => {
  const { article_id } = req.query;

  if (!article_id) return res.status(400).json({ error: "Se requiere article_id" });

  const sql = "SELECT * FROM comments WHERE status = 'approved' AND article_id = ?";
  
  // Imprimir la consulta y los parámetros para verificar que todo esté correcto
  console.log(`Ejecutando consulta: ${sql} con article_id: ${article_id}`);

  db.query(sql, [article_id], (err, results) => {
    if (err) {
      console.error("Error al obtener comentarios:", err);
      return res.status(500).send(err);
    }

    console.log("Resultados obtenidos:", results);
    res.json(results);
  });
});


// Obtener todos los comentarios (para admins)
app.get("/all-comments", (req, res) => {
  // Verificar si el usuario está autenticado por el token
  const isAuthenticated = req.headers.authorization && req.headers.authorization.startsWith("Bearer ");

  if (isAuthenticated) {
    // Si hay token, procesar la autenticación
    authenticateAdmin(req, res, () => {
      // Si el usuario es autenticado, obtener todos los comentarios
      db.query("SELECT * FROM comments", (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);  // Responder con todos los comentarios
      });
    });
  } else {
    // Si no hay token, devolver solo los comentarios aprobados
    db.query("SELECT * FROM comments WHERE status = 'approved'", (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results);  // Responder solo con los comentarios aprobados
    });
  }
});




// Aprobar comentario (solo admin)
app.put("/approve/:id", authenticateAdmin, (req, res) => {
  const { id } = req.params;
  db.query("UPDATE comments SET status = 'approved' WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json({ message: "Comentario aprobado" });
  });
});

// Eliminar comentario (solo admin)
app.delete("/delete/:id", authenticateAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM comments WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json({ message: "Comentario eliminado" });
  });
});

// 🟢 RUTAS DE ARTÍCULOS

// Crear un artículo con imagen (solo admin)
app.post("/articles", authenticateAdmin, upload.single("image"), (req, res) => {
  const { title, excerpt } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  if (!title || !excerpt || !image)
    return res.status(400).json({ message: "Todos los campos son obligatorios" });

  const sql = "INSERT INTO articles (title, excerpt, image) VALUES (?, ?, ?)";
  db.query(sql, [title, excerpt, image], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json({ message: "Artículo creado exitosamente", articleId: result.insertId });
  });
});

// Obtener todos los artículos
app.get("/articles", (req, res) => {
  db.query("SELECT * FROM articles", (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// Servir imágenes estáticas
app.use("/uploads", express.static("uploads"));


// Desaprobar comentario (solo admin)
app.patch("/comments/:id/disapprove", authenticateAdmin, (req, res) => {
  const { id } = req.params;
  db.query("UPDATE comments SET status = 'disapproved' WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json({ message: "Comentario desaprobado" });
  });
});

// Obtener un comentario por ID
app.get("/comments/:id", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM comments WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).json({ message: "Comentario no encontrado" });
    res.json(result[0]);
  });
});


// Editar un comentario (solo admin)
app.put("/comments/:id", authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ message: "El contenido es obligatorio" });

  db.query("UPDATE comments SET content = ? WHERE id = ?", [content, id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Comentario no encontrado" });
    res.json({ message: "Comentario actualizado" });
  });
});

// Eliminar un artículo (solo admin)
app.delete("/articles/:id", authenticateAdmin, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM articles WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Artículo no encontrado" });
    res.json({ message: "Artículo eliminado" });
  });
});

const { body, validationResult } = require('express-validator');

// Validación de datos al agregar un comentario
app.post("/comments", [
  body('author').isLength({ min: 1 }).withMessage('El nombre es obligatorio'),
  body('email').isEmail().withMessage('El correo debe ser válido'),
  body('content').isLength({ min: 1 }).withMessage('El comentario no puede estar vacío'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Si la validación pasa, procede a guardar el comentario
  const { author, email, content, article_id } = req.body;
  const status = "pending";
  const created_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sql = `INSERT INTO comments (author, email, content, status, created_at, article_id) VALUES (?, ?, ?, ?, ?, ?)`;
  db.query(sql, [author, email, content, status, created_at, article_id], (err, result) => {
    if (err) return res.status(500).json({ error: "Error interno del servidor" });

    res.status(201).json({ id: result.insertId, author, email, content, status, created_at, article_id });
  });
});

// 🟢 INICIAR SERVIDOR
app.listen(5001, () => {
  console.log("🚀 Servidor corriendo en http://localhost:5001");
});
