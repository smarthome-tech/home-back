# SmartHome Products Backend API 🏠

A Node.js/Express backend API for managing smart home products with image upload capabilities using Cloudinary and MongoDB.

## 🎯 Features

- ✅ Product CRUD operations (Create, Read, Update, Delete)
- 📸 Image upload support (main image + up to 10 additional photos)
- ☁️ Cloudinary integration for image storage
- 🗄️ MongoDB database with Mongoose ODM
- 🔒 Input validation and error handling
- 🚀 Production-ready with graceful shutdown

## 📦 Product Schema

Each product includes:

- **name** (required) - Product name
- **price** (required) - Product price (number)
- **mainImage** (required) - Main product photo
- **otherPhotos** (optional) - Up to 10 additional photos
- **description** (optional) - Product description
- **classifications** (optional) - Product categories/tags

## 🚀 Installation

1. **Install dependencies:**

```bash
npm install
```

2. **Environment Setup:**
   - Rename `.env.example` to `.env` (or use the `.env` file provided)
   - Your credentials are already configured in the `.env` file!

3. **Start the server:**

```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

## 📝 API Endpoints

### Health Check

```http
GET /
```

Returns server status and database connection info.

---

### Get All Products

```http
GET /products
```

Returns all products sorted by upload date (newest first).

**Response Example:**

```json
{
  "products": [
    {
      "_id": "65c1f2a3b4d5e6f7g8h9i0j1",
      "name": "Smart Thermostat",
      "price": 199.99,
      "mainImage": "https://res.cloudinary.com/...",
      "otherPhotos": ["https://...", "https://..."],
      "description": "Energy-efficient smart thermostat",
      "classifications": "heating, automation, energy-saving",
      "uploadDate": "2024-02-04T12:00:00.000Z",
      "createdAt": "2024-02-04T12:00:00.000Z",
      "updatedAt": "2024-02-04T12:00:00.000Z"
    }
  ]
}
```

---

### Get Single Product

```http
GET /products/:id
```

Returns a specific product by ID.

**Example:**

```bash
GET /products/65c1f2a3b4d5e6f7g8h9i0j1
```

---

### Create Product

```http
POST /products/upload
```

**Content-Type:** `multipart/form-data`

**Required Fields:**

- `name` (text) - Product name
- `price` (number) - Product price
- `mainImage` (file) - Main product photo

**Optional Fields:**

- `otherPhotos` (files, max 10) - Additional product photos
- `description` (text) - Product description
- `classifications` (text) - Product categories/tags

**JavaScript Example:**

```javascript
const formData = new FormData();
formData.append("name", "Smart Light Bulb");
formData.append("price", "29.99");
formData.append("description", "RGB smart bulb with app control");
formData.append("classifications", "lighting, rgb, wifi");
formData.append("mainImage", mainImageFile); // File object
formData.append("otherPhotos", photo1File); // File object
formData.append("otherPhotos", photo2File); // File object

const response = await fetch("http://localhost:5001/products/upload", {
  method: "POST",
  body: formData,
});

const result = await response.json();
console.log(result);
```

**cURL Example:**

```bash
curl -X POST http://localhost:5001/products/upload \
  -F "name=Smart Light Bulb" \
  -F "price=29.99" \
  -F "description=RGB smart bulb with app control" \
  -F "classifications=lighting, rgb, wifi" \
  -F "mainImage=@/path/to/main-image.jpg" \
  -F "otherPhotos=@/path/to/photo1.jpg" \
  -F "otherPhotos=@/path/to/photo2.jpg"
```

---

### Update Product

```http
PUT /products/:id
```

**Content-Type:** `multipart/form-data`

All fields are optional. Only include fields you want to update.

**JavaScript Example:**

```javascript
const formData = new FormData();
formData.append("price", "24.99"); // Update price
formData.append("description", "Updated description");

const response = await fetch(
  "http://localhost:5001/products/65c1f2a3b4d5e6f7g8h9i0j1",
  {
    method: "PUT",
    body: formData,
  },
);
```

---

### Delete Product

```http
DELETE /products/:id
```

Deletes the product and all associated images from Cloudinary.

**JavaScript Example:**

```javascript
const response = await fetch(
  "http://localhost:5001/products/65c1f2a3b4d5e6f7g8h9i0j1",
  {
    method: "DELETE",
  },
);
```

## 🔐 Environment Variables

Your `.env` file is already configured with:

```env
# MongoDB Configuration
MONGODB_URI=mongodb+srv://smarthomeweb23_db_user:smarthomeweb23_db_password@cluster0.yi4rbrc.mongodb.net/?appName=Cluster0

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=dqjoif9uz
CLOUDINARY_API_KEY=619477149959252
CLOUDINARY_API_SECRET=ZhKvGXNokRuqmfhJKozgakBEQjg

# Server Configuration
PORT=5001
```

## 📊 Error Handling

The API returns appropriate HTTP status codes:

| Code  | Description                                      |
| ----- | ------------------------------------------------ |
| `200` | Success                                          |
| `201` | Created                                          |
| `400` | Bad Request (validation errors)                  |
| `404` | Not Found                                        |
| `500` | Server Error                                     |
| `503` | Service Unavailable (database connection issues) |

**Error Response Example:**

```json
{
  "error": "Product name is required"
}
```

## 🗄️ MongoDB Setup Notes

Your MongoDB is already configured! But if you need to modify settings:

1. Go to MongoDB Atlas
2. Navigate to Network Access
3. Add IP address `0.0.0.0/0` for development (or your specific IP)
4. Make sure your cluster is running

## ☁️ Cloudinary Notes

**About the two API keys:**

- Cloudinary shows a "Root" key and potentially other keys
- Your `.env` is using the **Root** key which has full access
- This is correct and what you need!

All uploaded images are stored in the `smarthome-products` folder on Cloudinary.

## 🛠️ Development Tips

- The server uses `nodemon` for auto-restart during development
- Images are automatically deleted from Cloudinary when products are deleted or updated
- Database connection is checked before processing requests
- Maximum file size for images: 10MB per file
- Supported image formats: jpg, png, jpeg, gif, webp, svg

## 📱 Testing the API

### Using Postman:

1. Create a new POST request to `http://localhost:5001/products/upload`
2. Select "Body" → "form-data"
3. Add fields:
   - `name` (Text): "Test Product"
   - `price` (Text): "99.99"
   - `mainImage` (File): Select an image file
   - `description` (Text): "Test description"
   - `classifications` (Text): "test, demo"
4. Send the request!

### Using JavaScript/React:

```javascript
const handleUpload = async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append("name", productName);
  formData.append("price", productPrice);
  formData.append("mainImage", mainImageFile);
  formData.append("description", productDescription);
  formData.append("classifications", productClassifications);

  // Add other photos
  otherPhotosArray.forEach((photo) => {
    formData.append("otherPhotos", photo);
  });

  try {
    const response = await fetch("http://localhost:5001/products/upload", {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (response.ok) {
      console.log("Product created:", result.product);
    } else {
      console.error("Error:", result.error);
    }
  } catch (error) {
    console.error("Upload failed:", error);
  }
};
```

## 🚀 Production Deployment

1. Set all environment variables on your hosting platform (Heroku, Railway, Render, etc.)
2. Use `npm start` to run the server
3. Configure CORS settings for your frontend domain if needed
4. Make sure MongoDB Atlas allows connections from your production server

## 📄 License

ISC

---

**Need help?** Check the console output when starting the server - it shows all available endpoints and connection status! 🎉
# home-back
