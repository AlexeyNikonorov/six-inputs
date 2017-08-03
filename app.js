var express = require('express')
var session = require('express-session')
var bodyParser = require('body-parser')
var formidable = require('formidable')
var archiver = require('archiver')
var fs = require('fs')
var path = require('path')

function validatePersonalData(login, password, callback) {
	if (!login) {
		callback(false)
	}
	return callback(true)
}

function retrieveOrderById(id, callback) {
	var filepath = path.join('orders', id.toString(), 'data.json')
	var opts = {encoding: 'utf-8'}
	fs.readFile(filepath, opts, function(err, file) {
		if (err) {
			callback(null)
			return
		}
		var data = JSON.parse(file)
		callback(data)
	})
}

function retrieveOrders(callback) {
	fs.readdir('orders', function(err, files) {
		var orders = []
		for (var i = 0; i < files.length; i++) {
			try {
				var datapath = path.join('orders', files[i], 'data.json')
				var data = fs.readFileSync(datapath, 'utf-8')
				orders.push(JSON.parse(data))
			} catch (err) {
				continue
			}
		}
		callback(orders)
	})
}

function updateOrder(id, login, callback) {
	if (!login) {
		callback("invalid login", null)
		return
	}
	var filepath = path.join('orders', id.toString(), 'data.json')
	var order = fs.readFileSync(filepath, {encoding: 'utf-8'})
	order = JSON.parse(order)
	if (order.appliedBy.indexOf(login) != -1) {
		callback("already in list", null)
		return
	}
	order.appliedBy.push(login)
	if (order.status === 'Новый') {
		order.status = 'Выполняется'
	}
	fs.writeFile(filepath, JSON.stringify(order, null, 2))
	callback("applied", order)
}

function updateOrderSolved(id, login) {
	if (!login) {
		callback(null)
		return
	}
	var filepath = path.join('orders', id.toString(), 'data.json')
	var order = fs.readFileSync(filepath, {encoding: 'utf-8'})
	order = JSON.parse(order)
	if (order.solvedBy.indexOf(login) == -1) {
		order.solvedBy.push(login)
		order.status = 'Выполнен'
	}
	fs.writeFile(filepath, JSON.stringify(order, null, 2))
}

function handlePost(req, callback) {
	var form = new formidable.IncomingForm({
		multiples: true
	}).on('fileBegin', function(name, file) {
		if (file.name) { 
			file.path = path.join(this.uploadDir, file.name)
		}
	})
	form.onPart = function(part) {
		if (part.name == 'files' && !part.filename) {
			return
		}
		form.handlePart(part)
	}
	form.parse(req, callback)
}

function storeFiles(fields, files, dirpath, callback) {
	fs.mkdir(dirpath, function(err) {
		if (!files.files) {
			callback()
			return
		}
		if (files.files instanceof Array) {
			for (var i = 0; i < files.files.length; i++) {
				var oldpath = files.files[i].path
				var newpath = path.join(dirpath, files.files[i].name)
				files.files[i].path = newpath
				fs.rename(oldpath, newpath)
			}
		} else {
			var oldpath = files.files.path
			var newpath = path.join(dirpath, files.files.name)
			files.files.path = newpath
			fs.rename(oldpath, newpath)
		}
		callback()
	})
}

function zipFiles(fields, files, zippath) {
	if (!files.files) {
		return
	}
	var output = fs.createWriteStream(zippath)
	var archive = archiver('zip', {store: true})
	archive.pipe(output)
	if (files.files instanceof Array) {
		for (var i = 0; i < files.files.length; i++) {
			var filename = files.files[i].name
			var filepath = files.files[i].path
			archive.append(fs.createReadStream(filepath), {name: filename})
		}
	} else {
		var filename = files.files.name
		var filepath = files.files.path
		archive.append(fs.createReadStream(filepath), {name: filename})
	}
	archive.finalize()
}

function storeOrderData(fields, files, dirpath, zippath) {
	if (!files.files) {
		fields.link = null
		fields.attachments = 0
	} else {
		fields.link = zippath
		if (files.files instanceof Array) {
			fields.attachments = files.files.length
		} else {
			fields.attachments = 1
		}
	}
	fields.status = 'Новый'
	fields.appliedBy = []
	fields.solvedBy = []
	var data = JSON.stringify(fields, null, 2)
	var filepath = path.join(dirpath, 'data.json')
	fs.writeFile(filepath, data)
}

var app = express()

var siteOpts = {
	index: path.join(__dirname, 'public', 'index.html'),
	author: path.join(__dirname, 'public', 'author.html'),
}

app.use(express.static('public/js'))
app.use(express.static('public/css'))
app.use(express.static('orders'))
app.use(session({
	secret: 'qwef-321d-fsdw-fdse',
	saveUninitialized: false,
	resave: false,
}))
app.use(bodyParser.urlencoded({
	extended: false
}))

app.get('/', function(req, res) {
	res.sendFile(siteOpts.index)
})

app.post('/', function(req, res) {
	handlePost(req, function(err, fields, files) {
		var date = new Date()
		fields.id = date.getTime()
		fields.posted = date.toString()
		var dirname = fields.id.toString()
		var dirpath = path.join('orders', dirname)
		var zippath = path.join(dirpath, 'attachments.zip')
		storeFiles(fields, files, dirpath, function() {
			zipFiles(fields, files, zippath)
			storeOrderData(fields, files, dirpath, zippath)
		})
		res.sendFile(siteOpts.index)
	})
})

app.post('/author', function(req, res) {
	validatePersonalData(req.body.login, req.body.password, function(status) {
		if (status) {
			req.session.login = req.body.login
			res.sendFile(siteOpts.author)
		} else {
			res.send('Invalid personal data')
		}
	})
})

app.get('/author', function(req, res) {
	res.sendFile(siteOpts.author)
})

app.get('/orders', function(req, res) {
	retrieveOrders(function(orders) {
		res.send(orders)
	})
})

app.post('/details', function(req, res) {
	req.session.lastViewed = req.body.id
	retrieveOrderById(req.body.id, function(order) {
		res.send(order)
	})
})

app.get('/orders/*', function(req, res) {
	res.sendFile(path.join(__dirname, req.url))
})

app.post('/apply', function(req, res) {
	updateOrder(req.body.id, req.session.login, function(status, order) {
		res.send({status: status, order: order})
	})
})

app.post('/upload', function(req, res) {
	handlePost(req, function(err, fields, files) {
		var dirname = 'solution'
		var dirpath = path.join('orders', req.session.lastViewed, dirname)
		var zippath = path.join(dirpath, 'solution.zip')
		storeFiles(fields, files, dirpath, function() {
			zipFiles(fields, files, zippath)
			updateOrderSolved(req.session.lastViewed, req.session.login)
		})
		res.sendFile(siteOpts.author)
	})
})

app.listen(3000)
