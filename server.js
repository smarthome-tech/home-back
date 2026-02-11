import express from "express";
import cors from "cors";
import multer from "multer";
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const safeCloudinaryDestroy = async (publicId, resourceType = 'image') => {
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (e) {
      console.warn(`Could not destroy Cloudinary asset ${publicId}:`, e);
    }
  }
};

// --- CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5001;

// --- SCHEMAS ---

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  mainImage: { type: String, required: true },
  mainImagePublicId: { type: String, required: true },
  otherPhotos: [{ type: String }],
  otherPhotosPublicIds: [{ type: String }],
  description: { type: String, required: false },
  classifications: { type: String, required: false, trim: true },
  status: {
    type: String,
    enum: ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'],
    default: 'available',
    required: false
  },
  statusNote: { type: String, trim: true, required: false },
  expectedArrival: { type: Date, required: false },
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// Uses 'siteconfigs' collection — completely separate from old 'sitesettings'
const siteConfigSchema = new mongoose.Schema({
  landingTitle: { type: String, default: '' },
  landingDescription: { type: String, default: '' },
  aboutText: { type: String, default: '' },
  servicesText: { type: String, default: '' },
  landingBanner: { type: String, default: '' },
  landingBannerPublicId: { type: String, default: '' },
  logo: { type: String, default: '' },
  logoPublicId: { type: String, default: '' },
}, { timestamps: true });

// --- MODELS ---
const Product = mongoose.model('Product', productSchema);
const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);

// --- EXPRESS ---
const app = express();

app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  next();
};

// --- MULTER / CLOUDINARY ---
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'smarthome-products',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp', 'svg'],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
      return `${timestamp}-${safeName.split('.')[0]}`;
    },
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// --- HEALTH CHECK ---
app.get("/", (req, res) => {
  res.json({
    message: "SmartHome Products API ✅",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    readyState: mongoose.connection.readyState
  });
});

// ========== PRODUCTS ==========

app.post("/products/upload", checkDbConnection, uploadImage.fields([
  { name: 'mainImage', maxCount: 1 },
  { name: 'otherPhotos', maxCount: 10 }
]), async (req, res) => {
  console.log('📦 Product upload request');
  try {
    const { name, price, description, classifications, status, statusNote, expectedArrival } = req.body;

    if (!name) return res.status(400).json({ error: "Product name is required" });
    if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: "Valid price is required" });
    if (!req.files || !req.files.mainImage) return res.status(400).json({ error: "Main image is required" });

    const mainImageFile = req.files.mainImage[0];
    const otherPhotosFiles = req.files.otherPhotos || [];

    const productData = {
      name: name.trim(),
      price: parseFloat(price),
      mainImage: mainImageFile.path,
      mainImagePublicId: mainImageFile.filename,
      otherPhotos: otherPhotosFiles.map(f => f.path),
      otherPhotosPublicIds: otherPhotosFiles.map(f => f.filename),
      description: description || '',
      classifications: classifications ? classifications.trim() : '',
    };

    if (status) productData.status = status;
    if (statusNote) productData.statusNote = statusNote.trim();
    if (expectedArrival) productData.expectedArrival = new Date(expectedArrival);

    const newProduct = new Product(productData);
    await newProduct.save();
    console.log(`✅ Product created: ${newProduct._id}`);
    res.status(201).json({ message: "Product created successfully!", product: newProduct });
  } catch (error) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({ error: "Failed to create product", details: error.message });
  }
});

app.get("/products", checkDbConnection, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const products = await Product.find(filter).sort({ uploadDate: -1 });
    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/products/:id", checkDbConnection, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ product });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

app.put("/products/:id", checkDbConnection, uploadImage.fields([
  { name: 'mainImage', maxCount: 1 },
  { name: 'otherPhotos', maxCount: 10 }
]), async (req, res) => {
  try {
    const { name, price, description, classifications, status, statusNote, expectedArrival } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    if (name) product.name = name.trim();
    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) return res.status(400).json({ error: "Invalid price value" });
      product.price = parsedPrice;
    }
    if (description !== undefined) product.description = description;
    if (classifications !== undefined) product.classifications = classifications.trim();
    if (status !== undefined) product.status = status;
    if (statusNote !== undefined) product.statusNote = statusNote.trim();
    if (expectedArrival !== undefined) {
      product.expectedArrival = expectedArrival ? new Date(expectedArrival) : null;
    }

    if (req.files && req.files.mainImage) {
      await safeCloudinaryDestroy(product.mainImagePublicId);
      const f = req.files.mainImage[0];
      product.mainImage = f.path;
      product.mainImagePublicId = f.filename;
    }

    if (req.files && req.files.otherPhotos) {
      for (const publicId of product.otherPhotosPublicIds) {
        await safeCloudinaryDestroy(publicId);
      }
      const otherPhotosFiles = req.files.otherPhotos;
      product.otherPhotos = otherPhotosFiles.map(f => f.path);
      product.otherPhotosPublicIds = otherPhotosFiles.map(f => f.filename);
    }

    await product.save();
    console.log(`✅ Product updated: ${req.params.id}`);
    res.json({ message: "Product updated successfully", product });
  } catch (error) {
    console.error('❌ Error updating product:', error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.patch("/products/:id/status", checkDbConnection, async (req, res) => {
  try {
    const { status, statusNote, expectedArrival } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const validStatuses = ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status", validStatuses });
    }

    if (status !== undefined) product.status = status;
    if (statusNote !== undefined) product.statusNote = statusNote.trim();
    if (expectedArrival !== undefined) {
      product.expectedArrival = expectedArrival ? new Date(expectedArrival) : null;
    }

    await product.save();
    res.json({ message: "Product status updated successfully", product });
  } catch (error) {
    res.status(500).json({ error: "Failed to update product status" });
  }
});

app.delete("/products/:id", checkDbConnection, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    await safeCloudinaryDestroy(product.mainImagePublicId);
    for (const publicId of product.otherPhotosPublicIds) {
      await safeCloudinaryDestroy(publicId);
    }

    await Product.findByIdAndDelete(req.params.id);
    console.log(`✅ Product deleted: ${req.params.id}`);
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

app.get("/products/status/:status", checkDbConnection, async (req, res) => {
  try {
    const { status } = req.params;
    const validStatuses = ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status", validStatuses });
    }
    const products = await Product.find({ status }).sort({ uploadDate: -1 });
    res.json({ products, count: products.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ========== SITE CONFIG ==========

const getOrCreateConfig = async () => {
  let config = await SiteConfig.findOne();
  if (!config) {
    config = new SiteConfig();
    await config.save();
    console.log('✅ Created fresh site config');
  }
  return config;
};

app.get("/settings", checkDbConnection, async (req, res) => {
  try {
    const settings = await getOrCreateConfig();
    res.json({ settings });
  } catch (error) {
    console.error('❌ Error fetching config:', error);
    res.status(500).json({ error: "Failed to fetch site settings", details: error.message });
  }
});

app.put("/settings", checkDbConnection, uploadImage.fields([
  { name: 'landingBanner', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), async (req, res) => {
  try {
    const { landingTitle, landingDescription, aboutText, servicesText } = req.body;
    const settings = await getOrCreateConfig();

    if (landingTitle !== undefined) settings.landingTitle = landingTitle;
    if (landingDescription !== undefined) settings.landingDescription = landingDescription;
    if (aboutText !== undefined) settings.aboutText = aboutText;
    if (servicesText !== undefined) settings.servicesText = servicesText;

    if (req.files && req.files.landingBanner) {
      await safeCloudinaryDestroy(settings.landingBannerPublicId);
      const f = req.files.landingBanner[0];
      settings.landingBanner = f.path;
      settings.landingBannerPublicId = f.filename;
    }

    if (req.files && req.files.logo) {
      await safeCloudinaryDestroy(settings.logoPublicId);
      const f = req.files.logo[0];
      settings.logo = f.path;
      settings.logoPublicId = f.filename;
    }

    await settings.save();
    console.log('✅ Site config updated');
    res.json({ message: "Site settings updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating config:', error);
    res.status(500).json({ error: "Failed to update site settings", details: error.message });
  }
});

app.patch("/settings/landing", checkDbConnection, async (req, res) => {
  try {
    const { landingTitle, landingDescription } = req.body;
    const settings = await getOrCreateConfig();

    if (landingTitle !== undefined) settings.landingTitle = landingTitle;
    if (landingDescription !== undefined) settings.landingDescription = landingDescription;

    await settings.save();
    console.log('✅ Landing text updated');
    res.json({ message: "Landing text updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating landing:', error);
    res.status(500).json({ error: "Failed to update landing text", details: error.message });
  }
});

app.patch("/settings/about", checkDbConnection, async (req, res) => {
  try {
    const { aboutText } = req.body;
    const settings = await getOrCreateConfig();

    if (aboutText !== undefined) settings.aboutText = aboutText;

    await settings.save();
    console.log('✅ About text updated');
    res.json({ message: "About text updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating about:', error);
    res.status(500).json({ error: "Failed to update about text", details: error.message });
  }
});

app.patch("/settings/services", checkDbConnection, async (req, res) => {
  try {
    const { servicesText } = req.body;
    const settings = await getOrCreateConfig();

    if (servicesText !== undefined) settings.servicesText = servicesText;

    await settings.save();
    console.log('✅ Services text updated');
    res.json({ message: "Services text updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating services:', error);
    res.status(500).json({ error: "Failed to update services text", details: error.message });
  }
});

app.patch("/settings/banner", checkDbConnection, uploadImage.single('landingBanner'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Landing banner image is required" });

    const settings = await getOrCreateConfig();
    await safeCloudinaryDestroy(settings.landingBannerPublicId);

    settings.landingBanner = req.file.path;
    settings.landingBannerPublicId = req.file.filename;

    await settings.save();
    console.log('✅ Banner updated');
    res.json({ message: "Landing banner updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating banner:', error);
    res.status(500).json({ error: "Failed to update landing banner", details: error.message });
  }
});

app.patch("/settings/logo", checkDbConnection, uploadImage.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Logo image is required" });

    const settings = await getOrCreateConfig();
    await safeCloudinaryDestroy(settings.logoPublicId);

    settings.logo = req.file.path;
    settings.logoPublicId = req.file.filename;

    await settings.save();
    console.log('✅ Logo updated');
    res.json({ message: "Logo updated successfully", settings });
  } catch (error) {
    console.error('❌ Error updating logo:', error);
    res.status(500).json({ error: "Failed to update logo", details: error.message });
  }
});

// --- Global Error Handler ---
app.use((error, req, res, next) => {
  console.error('💥 Error:', error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message || 'Something went wrong!' });
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- START ---
const startServer = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 MongoDB URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));

    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB!');
    console.log('📊 Database:', mongoose.connection.db.databaseName);

    const server = app.listen(PORT, () => {
      console.log(`\n🚀 SmartHome Server on port ${PORT}`);
      console.log('\n📋 Endpoints:');
      console.log('   GET    /                        - Health check');
      console.log('   GET    /products                - Get all products');
      console.log('   POST   /products/upload         - Create product');
      console.log('   GET    /products/:id            - Get single product');
      console.log('   PUT    /products/:id            - Update product');
      console.log('   PATCH  /products/:id/status     - Update product status');
      console.log('   DELETE /products/:id            - Delete product');
      console.log('   GET    /products/status/:status - Get by status');
      console.log('   GET    /settings                - Get site config');
      console.log('   PUT    /settings                - Update all settings');
      console.log('   PATCH  /settings/landing        - Update landing text');
      console.log('   PATCH  /settings/about          - Update about text');
      console.log('   PATCH  /settings/services       - Update services text');
      console.log('   PATCH  /settings/banner         - Update banner image');
      console.log('   PATCH  /settings/logo           - Update logo image');
      console.log('\n✅ Ready!\n');
    });

    mongoose.connection.on('disconnected', () => console.log('⚠️  MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));
    mongoose.connection.on('error', err => console.error('❌ MongoDB error:', err));

    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      try { await mongoose.connection.close(); } catch (e) { }
      server.close(() => { process.exit(0); });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
};

startServer();