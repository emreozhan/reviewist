#!/usr/bin/env node
/**
 * Reviewist örnek Java deposu üretici.
 *
 * Çıktı: fixtures/sample-repo (git deposu)
 *   - main                 : taban (Maven projesi "shop", hexagonal yapı)
 *   - feature/ai-refactor  : AI tarzı büyük refactor (3 commit)
 *   - feature/small-fix    : küçük hata düzeltmesi (1 commit)
 *
 * Deterministiktir: sabit yazar/tarih ile her çalıştırmada aynı SHA'lar üretilir.
 * Beklenen analiz sonuçları: fixtures/EXPECTED.md
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, 'fixtures', 'sample-repo');

const GIT_CONFIG = [
  '-c', 'user.name=Fixture',
  '-c', 'user.email=fixture@example.com',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.autocrlf=false',
  '-c', 'core.safecrlf=false',
  '-c', 'init.defaultBranch=main',
];

const BASE_TIME = Date.UTC(2026, 0, 5, 9, 0, 0) / 1000; // 2026-01-05T09:00:00Z
let commitIndex = 0;

let emptyConfigPath;
function emptyGitConfig() {
  if (!emptyConfigPath) {
    emptyConfigPath = join(tmpdir(), `reviewist-fixture-gitconfig-${process.pid}`);
    writeFileSync(emptyConfigPath, '');
    process.once('exit', () => {
      try {
        rmSync(emptyConfigPath, { force: true });
      } catch {
        /* geçici dosya */
      }
    });
  }
  return emptyConfigPath;
}

function gitEnv() {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_CONFIG_PARAMETERS']) {
    delete env[key];
  }
  const date = `${BASE_TIME + commitIndex * 3600} +0000`;
  return {
    ...env,
    // Kullanıcının/sistemin git yapılandırması (global gitignore, imza, autocrlf) SHA'ları değiştirmesin.
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig(),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

function git(...args) {
  return execFileSync('git', [...GIT_CONFIG, ...args], {
    cwd: REPO,
    env: gitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// ---------------------------------------------------------------------------
// Durum yardımcıları: state = { [path]: content }
// ---------------------------------------------------------------------------

function writeState(prev, next) {
  for (const path of Object.keys(prev)) {
    if (!(path in next)) unlinkSync(join(REPO, path));
  }
  for (const [path, content] of Object.entries(next)) {
    if (prev[path] === content) continue;
    const abs = join(REPO, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content.replace(/\r\n/g, '\n'), { encoding: 'utf8' });
  }
}

function commit(prev, next, message) {
  writeState(prev, next);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  commitIndex += 1;
  return { ...next };
}

/** Tam olarak bir kez geçen metni değiştirir; bulunamazsa ya da birden fazlaysa hata verir. */
function edit(state, path, from, to) {
  const src = state[path];
  if (src === undefined) throw new Error(`Dosya yok: ${path}`);
  const first = src.indexOf(from);
  if (first < 0) throw new Error(`Metin bulunamadı (${path}): ${from.slice(0, 80)}`);
  if (src.indexOf(from, first + 1) >= 0) throw new Error(`Metin birden fazla geçiyor (${path}): ${from.slice(0, 80)}`);
  state[path] = src.slice(0, first) + to + src.slice(first + from.length);
}

function rename(state, from, to) {
  if (!(from in state)) throw new Error(`Dosya yok: ${from}`);
  state[to] = state[from];
  delete state[from];
}

/** Kozmetik dönüşüm: 4 boşluklu girinti -> sekme, import blokları ters sıraya. Anlam aynı kalır. */
function cosmeticReformat(src) {
  const lines = src.split('\n').map((line) => {
    const m = /^( +)/.exec(line);
    if (!m) return line;
    const n = m[1].length;
    return '\t'.repeat(Math.floor(n / 4)) + ' '.repeat(n % 4) + line.slice(n);
  });
  const importIdx = lines.map((l, i) => (l.startsWith('import ') ? i : -1)).filter((i) => i >= 0);
  const imports = importIdx.map((i) => lines[i]).reverse();
  importIdx.forEach((lineNo, k) => {
    lines[lineNo] = imports[k];
  });
  return lines.join('\n');
}

const j = String.raw;
const M = 'src/main/java/com/acme/shop/';
const T = 'src/test/java/com/acme/shop/';

// ---------------------------------------------------------------------------
// main: proje dosyaları
// ---------------------------------------------------------------------------

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.5</version>
        <relativePath/>
    </parent>

    <groupId>com.acme</groupId>
    <artifactId>shop</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <name>shop</name>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
`;

const APPLICATION_YML = `spring:
  application:
    name: shop
  datasource:
    url: jdbc:h2:mem:shop
    username: sa
    password: ""
  jpa:
    hibernate:
      ddl-auto: validate
    open-in-view: false

shop:
  payment:
    provider: stripe
    api-key: sk_test_placeholder
  notification:
    sender: noreply@acme.example
`;

const VALIDATE_BODY = j`(PlaceOrderCommand command) {
        if (command.lines() == null || command.lines().isEmpty()) {
            throw new InvalidOrderException("Order must contain at least one line");
        }
        if (command.currency() == null || command.currency().isBlank()) {
            throw new InvalidOrderException("Currency is required");
        }
        for (PlaceOrderCommand.Line line : command.lines()) {
            if (line.quantity() <= 0) {
                throw new InvalidOrderException("Quantity must be positive for " + line.sku());
            }
            if (line.unitPrice() == null || line.unitPrice().signum() < 0) {
                throw new InvalidOrderException("Unit price must not be negative for " + line.sku());
            }
        }
    }`;

const LEGACY_PAD = j`
    /**
     * Left-pads the value with zeros. Kept for old payment references.
     *
     * @deprecated use {@link String#format(String, Object...)} instead
     */
    @Deprecated
    public static String legacyPad(String value, int width) {
        StringBuilder builder = new StringBuilder(value == null ? "" : value);
        while (builder.length() < width) {
            builder.insert(0, '0');
        }
        return builder.toString();
    }
`;

const mainFiles = {
  '.gitignore': 'target/\n*.iml\n.idea/\n',
  '.gitattributes': '* text=auto eol=lf\n',
  'README.md': '# shop\n\nAcme sipariş servisi (Spring Boot, hexagonal mimari). Reviewist örnek deposu.\n',
  'pom.xml': POM,
  'src/main/resources/application.yml': APPLICATION_YML,

  [`${M}ShopApplication.java`]: j`package com.acme.shop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ShopApplication {

    public static void main(String[] args) {
        SpringApplication.run(ShopApplication.class, args);
    }
}
`,

  // ----- domain/model -----
  [`${M}domain/model/OrderStatus.java`]: j`package com.acme.shop.domain.model;

public enum OrderStatus {
    NEW,
    PAID,
    SHIPPED,
    CANCELLED
}
`,

  [`${M}domain/model/Money.java`]: j`package com.acme.shop.domain.model;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Immutable monetary amount with a currency. Scale is always 2.
 */
public final class Money {

    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        this.amount = Objects.requireNonNull(amount, "amount").setScale(2, RoundingMode.HALF_UP);
        this.currency = Objects.requireNonNull(currency, "currency");
    }

    public static Money of(String amount, String currency) {
        return new Money(new BigDecimal(amount), currency);
    }

    public static Money zero(String currency) {
        return new Money(BigDecimal.ZERO, currency);
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money subtract(Money other) {
        requireSameCurrency(other);
        return new Money(amount.subtract(other.amount), currency);
    }

    public Money multiply(int factor) {
        return new Money(amount.multiply(BigDecimal.valueOf(factor)), currency);
    }

    public Money percentage(int percent) {
        BigDecimal part = amount.multiply(BigDecimal.valueOf(percent))
                .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
        return new Money(part, currency);
    }

    public boolean isGreaterThan(Money other) {
        requireSameCurrency(other);
        return amount.compareTo(other.amount) > 0;
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch: " + currency + " vs " + other.currency);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Money other)) {
            return false;
        }
        return amount.compareTo(other.amount) == 0 && currency.equals(other.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount.stripTrailingZeros(), currency);
    }

    @Override
    public String toString() {
        return amount.toPlainString() + " " + currency;
    }
}
`,

  [`${M}domain/model/Customer.java`]: j`package com.acme.shop.domain.model;

import java.util.Objects;

public class Customer {

    private final String id;
    private final String email;
    private final String phone;
    private final boolean premium;

    public Customer(String id, String email, String phone, boolean premium) {
        this.id = Objects.requireNonNull(id, "id");
        this.email = email;
        this.phone = phone;
        this.premium = premium;
    }

    public String getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPhone() {
        return phone;
    }

    public boolean isPremium() {
        return premium;
    }
}
`,

  [`${M}domain/model/OrderLine.java`]: j`package com.acme.shop.domain.model;

import java.util.Objects;

public class OrderLine {

    private final String sku;
    private final int quantity;
    private final Money unitPrice;

    public OrderLine(String sku, int quantity, Money unitPrice) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("Quantity must be positive");
        }
        this.sku = Objects.requireNonNull(sku, "sku");
        this.quantity = quantity;
        this.unitPrice = Objects.requireNonNull(unitPrice, "unitPrice");
    }

    public String getSku() {
        return sku;
    }

    public int getQuantity() {
        return quantity;
    }

    public Money getUnitPrice() {
        return unitPrice;
    }

    public Money lineTotal() {
        return unitPrice.multiply(quantity);
    }
}
`,

  [`${M}domain/model/Order.java`]: j`package com.acme.shop.domain.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Order aggregate root.
 */
public class Order {

    private final String id;
    private final Customer customer;
    private final String currency;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status;

    public Order(String id, Customer customer, String currency) {
        this.id = Objects.requireNonNull(id, "id");
        this.customer = Objects.requireNonNull(customer, "customer");
        this.currency = Objects.requireNonNull(currency, "currency");
        this.status = OrderStatus.NEW;
    }

    public static Order restore(String id, Customer customer, String currency, OrderStatus status, List<OrderLine> lines) {
        Order order = new Order(id, customer, currency);
        order.lines.addAll(lines);
        order.status = status;
        return order;
    }

    public String getId() {
        return id;
    }

    public Customer getCustomer() {
        return customer;
    }

    public String getCurrency() {
        return currency;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public List<OrderLine> getLines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        if (status != OrderStatus.NEW) {
            throw new IllegalStateException("Only new orders can be modified");
        }
        if (!line.getUnitPrice().getCurrency().equals(currency)) {
            throw new IllegalArgumentException("Line currency must be " + currency);
        }
        lines.add(line);
    }

    public Money getTotal() {
        Money total = Money.zero(currency);
        for (OrderLine line : lines) {
            total = total.add(line.lineTotal());
        }
        return total;
    }

    public void markPaid() {
        if (status != OrderStatus.NEW) {
            throw new IllegalStateException("Order " + id + " cannot be paid in status " + status);
        }
        status = OrderStatus.PAID;
    }

    public void markShipped() {
        if (status != OrderStatus.PAID) {
            throw new IllegalStateException("Order " + id + " must be paid before shipping");
        }
        status = OrderStatus.SHIPPED;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Shipped orders cannot be cancelled");
        }
        status = OrderStatus.CANCELLED;
    }

    public boolean isCancelled() {
        return status == OrderStatus.CANCELLED;
    }
}
`,

  // ----- domain/service -----
  [`${M}domain/service/PricingService.java`]: j`package com.acme.shop.domain.service;

import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;

/**
 * Pure domain pricing rules.
 */
public class PricingService {

    static final int PREMIUM_DISCOUNT_PERCENT = 10;
    static final int BULK_DISCOUNT_PERCENT = 5;
    static final int BULK_QUANTITY_THRESHOLD = 10;

    public Money calculateTotal(Order order) {
        Money total = order.getTotal();
        if (order.getLines().isEmpty()) {
            return total;
        }
        Money discount = Money.zero(order.getCurrency());
        if (order.getCustomer().isPremium()) {
            discount = discount.add(total.percentage(PREMIUM_DISCOUNT_PERCENT));
        }
        if (totalQuantity(order) >= BULK_QUANTITY_THRESHOLD) {
            discount = discount.add(total.percentage(BULK_DISCOUNT_PERCENT));
        }
        return total.subtract(discount);
    }

    public Money shippingCost(Order order) {
        if (order.getTotal().isGreaterThan(Money.of("100.00", order.getCurrency()))) {
            return Money.zero(order.getCurrency());
        }
        return Money.of("4.99", order.getCurrency());
    }

    private int totalQuantity(Order order) {
        int quantity = 0;
        for (OrderLine line : order.getLines()) {
            quantity += line.getQuantity();
        }
        return quantity;
    }
}
`,

  // ----- domain/exception -----
  [`${M}domain/exception/OrderNotFoundException.java`]: j`package com.acme.shop.domain.exception;

public class OrderNotFoundException extends RuntimeException {

    public OrderNotFoundException(String orderId) {
        super("Order not found: " + orderId);
    }
}
`,

  [`${M}domain/exception/InvalidOrderException.java`]: j`package com.acme.shop.domain.exception;

public class InvalidOrderException extends RuntimeException {

    public InvalidOrderException(String message) {
        super(message);
    }
}
`,

  // ----- application/port/in -----
  [`${M}application/port/in/PlaceOrderCommand.java`]: j`package com.acme.shop.application.port.in;

import java.math.BigDecimal;
import java.util.List;

public record PlaceOrderCommand(
        String customerId,
        String email,
        String phone,
        boolean premium,
        String currency,
        String paymentMethod,
        List<Line> lines) {

    public record Line(String sku, int quantity, BigDecimal unitPrice) {
    }
}
`,

  [`${M}application/port/in/PlaceOrderUseCase.java`]: j`package com.acme.shop.application.port.in;

import com.acme.shop.domain.model.Order;

public interface PlaceOrderUseCase {

    Order placeOrder(PlaceOrderCommand command);
}
`,

  [`${M}application/port/in/CancelOrderUseCase.java`]: j`package com.acme.shop.application.port.in;

public interface CancelOrderUseCase {

    void cancelOrder(String orderId);
}
`,

  // ----- application/port/out -----
  [`${M}application/port/out/OrderRepository.java`]: j`package com.acme.shop.application.port.out;

import com.acme.shop.domain.model.Order;
import java.util.Optional;

public interface OrderRepository {

    Order save(Order order);

    Optional<Order> findById(String id);
}
`,

  [`${M}application/port/out/PaymentGateway.java`]: j`package com.acme.shop.application.port.out;

import com.acme.shop.domain.model.Money;

public interface PaymentGateway {

    /**
     * Charges the given amount and returns the provider transaction reference.
     */
    String charge(Money amount);
}
`,

  [`${M}application/port/out/NotificationPort.java`]: j`package com.acme.shop.application.port.out;

import com.acme.shop.domain.model.Order;

public interface NotificationPort {

    void notify(Order order);
}
`,

  // ----- application/service -----
  [`${M}application/service/PlaceOrderService.java`]: j`package com.acme.shop.application.service;

import com.acme.shop.application.port.in.PlaceOrderCommand;
import com.acme.shop.application.port.in.PlaceOrderUseCase;
import com.acme.shop.application.port.out.NotificationPort;
import com.acme.shop.application.port.out.OrderRepository;
import com.acme.shop.application.port.out.PaymentGateway;
import com.acme.shop.domain.exception.InvalidOrderException;
import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;
import com.acme.shop.domain.service.PricingService;
import java.util.UUID;

public class PlaceOrderService implements PlaceOrderUseCase {

    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;
    private final NotificationPort notificationPort;
    private final PricingService pricingService;

    public PlaceOrderService(
            OrderRepository orderRepository,
            PaymentGateway paymentGateway,
            NotificationPort notificationPort,
            PricingService pricingService) {
        this.orderRepository = orderRepository;
        this.paymentGateway = paymentGateway;
        this.notificationPort = notificationPort;
        this.pricingService = pricingService;
    }

    @Override
    public Order placeOrder(PlaceOrderCommand command) {
        validate(command);
        Customer customer = new Customer(command.customerId(), command.email(), command.phone(), command.premium());
        Order order = new Order(UUID.randomUUID().toString(), customer, command.currency());
        for (PlaceOrderCommand.Line line : command.lines()) {
            order.addLine(new OrderLine(line.sku(), line.quantity(), new Money(line.unitPrice(), command.currency())));
        }
        Money amount = pricingService.calculateTotal(order);
        paymentGateway.charge(amount);
        order.markPaid();
        Order saved = orderRepository.save(order);
        notificationPort.notify(saved);
        return saved;
    }

    private void validate${VALIDATE_BODY}
}
`,

  [`${M}application/service/CancelOrderService.java`]: j`package com.acme.shop.application.service;

import com.acme.shop.application.port.in.CancelOrderUseCase;
import com.acme.shop.application.port.out.NotificationPort;
import com.acme.shop.application.port.out.OrderRepository;
import com.acme.shop.domain.exception.OrderNotFoundException;
import com.acme.shop.domain.model.Order;

public class CancelOrderService implements CancelOrderUseCase {

    private final OrderRepository orderRepository;
    private final NotificationPort notificationPort;

    public CancelOrderService(OrderRepository orderRepository, NotificationPort notificationPort) {
        this.orderRepository = orderRepository;
        this.notificationPort = notificationPort;
    }

    @Override
    public void cancelOrder(String orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.cancel();
        orderRepository.save(order);
        notificationPort.notify(order);
    }
}
`,

  // ----- adapter/in/web -----
  [`${M}adapter/in/web/OrderRequest.java`]: j`package com.acme.shop.adapter.in.web;

import com.acme.shop.application.port.in.PlaceOrderCommand;
import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.List;

/**
 * Web request body for placing or quoting an order.
 */
public record OrderRequest(
        @NotBlank String customerId,
        @Email String email,
        String phone,
        boolean premium,
        @NotBlank String currency,
        @NotBlank String paymentMethod,
        @Valid @NotEmpty List<LineRequest> lines) {

    public record LineRequest(@NotBlank String sku, @Positive int quantity, @Positive BigDecimal unitPrice) {
    }

    public PlaceOrderCommand toCommand() {
        List<PlaceOrderCommand.Line> commandLines = lines.stream()
                .map(line -> new PlaceOrderCommand.Line(line.sku(), line.quantity(), line.unitPrice()))
                .toList();
        return new PlaceOrderCommand(customerId, email, phone, premium, currency, paymentMethod, commandLines);
    }

    public Order toDraftOrder() {
        Order draft = new Order("draft", new Customer(customerId, email, phone, premium), currency);
        for (LineRequest line : lines) {
            draft.addLine(new OrderLine(line.sku(), line.quantity(), new Money(line.unitPrice(), currency)));
        }
        return draft;
    }
}
`,

  [`${M}adapter/in/web/OrderResponse.java`]: j`package com.acme.shop.adapter.in.web;

import com.acme.shop.domain.model.Order;
import java.math.BigDecimal;

public record OrderResponse(String id, String status, BigDecimal total, String currency, int lineCount) {

    public static OrderResponse from(Order order) {
        return new OrderResponse(
                order.getId(),
                order.getStatus().name(),
                order.getTotal().getAmount(),
                order.getCurrency(),
                order.getLines().size());
    }
}
`,

  [`${M}adapter/in/web/OrderController.java`]: j`package com.acme.shop.adapter.in.web;

import com.acme.shop.application.port.in.CancelOrderUseCase;
import com.acme.shop.application.port.in.PlaceOrderUseCase;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.service.PricingService;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final PlaceOrderUseCase placeOrderUseCase;
    private final CancelOrderUseCase cancelOrderUseCase;
    private final PricingService pricingService;

    public OrderController(
            PlaceOrderUseCase placeOrderUseCase,
            CancelOrderUseCase cancelOrderUseCase,
            PricingService pricingService) {
        this.placeOrderUseCase = placeOrderUseCase;
        this.cancelOrderUseCase = cancelOrderUseCase;
        this.pricingService = pricingService;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> placeOrder(@Valid @RequestBody OrderRequest request) {
        Order order = placeOrderUseCase.placeOrder(request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED).body(OrderResponse.from(order));
    }

    @PostMapping("/quote")
    public ResponseEntity<Map<String, Object>> quote(@Valid @RequestBody OrderRequest request) {
        Order draft = request.toDraftOrder();
        Money total = pricingService.calculateTotal(draft);
        return ResponseEntity.ok(Map.of("total", total.getAmount(), "currency", total.getCurrency()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> cancel(@PathVariable String id) {
        cancelOrderUseCase.cancelOrder(id);
        return ResponseEntity.noContent().build();
    }
}
`,

  // ----- adapter/out/persistence -----
  [`${M}adapter/out/persistence/OrderEntity.java`]: j`package com.acme.shop.adapter.out.persistence;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "orders")
public class OrderEntity {

    @Id
    private String id;

    @Column(name = "customer_id", nullable = false)
    private String customerId;

    private String customerEmail;

    private String customerPhone;

    private boolean premium;

    @Column(length = 3, nullable = false)
    private String currency;

    @Column(nullable = false)
    private String status;

    @Column(name = "total_amount", precision = 19, scale = 2)
    private BigDecimal totalAmount;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "order_lines", joinColumns = @JoinColumn(name = "order_id"))
    private List<LineEmbeddable> lines = new ArrayList<>();

    protected OrderEntity() {
    }

    public OrderEntity(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }

    public String getCustomerId() {
        return customerId;
    }

    public void setCustomerId(String customerId) {
        this.customerId = customerId;
    }

    public String getCustomerEmail() {
        return customerEmail;
    }

    public void setCustomerEmail(String customerEmail) {
        this.customerEmail = customerEmail;
    }

    public String getCustomerPhone() {
        return customerPhone;
    }

    public void setCustomerPhone(String customerPhone) {
        this.customerPhone = customerPhone;
    }

    public boolean isPremium() {
        return premium;
    }

    public void setPremium(boolean premium) {
        this.premium = premium;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public void setTotalAmount(BigDecimal totalAmount) {
        this.totalAmount = totalAmount;
    }

    public List<LineEmbeddable> getLines() {
        return lines;
    }

    public void setLines(List<LineEmbeddable> lines) {
        this.lines = lines;
    }

    @Embeddable
    public static class LineEmbeddable {

        private String sku;

        private int quantity;

        @Column(precision = 19, scale = 2)
        private BigDecimal unitPrice;

        protected LineEmbeddable() {
        }

        public LineEmbeddable(String sku, int quantity, BigDecimal unitPrice) {
            this.sku = sku;
            this.quantity = quantity;
            this.unitPrice = unitPrice;
        }

        public String getSku() {
            return sku;
        }

        public int getQuantity() {
            return quantity;
        }

        public BigDecimal getUnitPrice() {
            return unitPrice;
        }
    }
}
`,

  [`${M}adapter/out/persistence/OrderJpaRepository.java`]: j`package com.acme.shop.adapter.out.persistence;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderJpaRepository extends JpaRepository<OrderEntity, String> {

    List<OrderEntity> findByCustomerId(String customerId);
}
`,

  [`${M}adapter/out/persistence/OrderMapper.java`]: j`package com.acme.shop.adapter.out.persistence;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;
import com.acme.shop.domain.model.OrderStatus;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class OrderMapper {

    public OrderEntity toEntity(Order order) {
        OrderEntity entity = new OrderEntity(order.getId());
        Customer customer = order.getCustomer();
        entity.setCustomerId(customer.getId());
        entity.setCustomerEmail(customer.getEmail());
        entity.setCustomerPhone(customer.getPhone());
        entity.setPremium(customer.isPremium());
        entity.setCurrency(order.getCurrency());
        entity.setStatus(order.getStatus().name());
        entity.setTotalAmount(order.getTotal().getAmount());
        List<OrderEntity.LineEmbeddable> lines = new ArrayList<>();
        for (OrderLine line : order.getLines()) {
            lines.add(new OrderEntity.LineEmbeddable(line.getSku(), line.getQuantity(), line.getUnitPrice().getAmount()));
        }
        entity.setLines(lines);
        return entity;
    }

    public Order toDomain(OrderEntity entity) {
        Customer customer = new Customer(
                entity.getCustomerId(), entity.getCustomerEmail(), entity.getCustomerPhone(), entity.isPremium());
        List<OrderLine> lines = entity.getLines().stream()
                .map(line -> new OrderLine(line.getSku(), line.getQuantity(), new Money(line.getUnitPrice(), entity.getCurrency())))
                .toList();
        return Order.restore(entity.getId(), customer, entity.getCurrency(), OrderStatus.valueOf(entity.getStatus()), lines);
    }
}
`,

  [`${M}adapter/out/persistence/OrderPersistenceAdapter.java`]: j`package com.acme.shop.adapter.out.persistence;

import com.acme.shop.application.port.out.OrderRepository;
import com.acme.shop.domain.model.Order;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class OrderPersistenceAdapter implements OrderRepository {

    private final OrderJpaRepository jpaRepository;
    private final OrderMapper mapper;

    public OrderPersistenceAdapter(OrderJpaRepository jpaRepository, OrderMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    @Override
    public Order save(Order order) {
        OrderEntity saved = jpaRepository.save(mapper.toEntity(order));
        return mapper.toDomain(saved);
    }

    @Override
    public Optional<Order> findById(String id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
`,

  // ----- adapter/out/payment -----
  [`${M}adapter/out/payment/PaymentReference.java`]: j`package com.acme.shop.adapter.out.payment;

import com.acme.shop.util.StringUtils;
import java.util.concurrent.atomic.AtomicLong;

final class PaymentReference {

    private static final AtomicLong SEQUENCE = new AtomicLong();

    private PaymentReference() {
    }

    static String next(String provider) {
        return provider + "-" + StringUtils.legacyPad(Long.toString(SEQUENCE.incrementAndGet()), 10);
    }
}
`,

  [`${M}adapter/out/payment/StripePaymentAdapter.java`]: j`package com.acme.shop.adapter.out.payment;

import com.acme.shop.application.port.out.PaymentGateway;
import com.acme.shop.domain.model.Money;
import java.util.logging.Logger;

public class StripePaymentAdapter implements PaymentGateway {

    private static final Logger LOG = Logger.getLogger(StripePaymentAdapter.class.getName());

    private final String apiKey;

    public StripePaymentAdapter(String apiKey) {
        this.apiKey = apiKey;
    }

    @Override
    public String charge(Money amount) {
        if (amount.getAmount().signum() <= 0) {
            throw new IllegalArgumentException("Charge amount must be positive");
        }
        String reference = PaymentReference.next("STRIPE");
        LOG.info(() -> "Stripe charge " + reference + " for " + amount + " using key " + apiKey.substring(0, 4) + "***");
        return reference;
    }
}
`,

  [`${M}adapter/out/payment/PaypalPaymentAdapter.java`]: j`package com.acme.shop.adapter.out.payment;

import com.acme.shop.application.port.out.PaymentGateway;
import com.acme.shop.domain.model.Money;
import java.util.Set;
import java.util.logging.Logger;

public class PaypalPaymentAdapter implements PaymentGateway {

    private static final Logger LOG = Logger.getLogger(PaypalPaymentAdapter.class.getName());
    private static final Set<String> SUPPORTED_CURRENCIES = Set.of("EUR", "USD", "GBP");

    private final String clientId;

    public PaypalPaymentAdapter(String clientId) {
        this.clientId = clientId;
    }

    @Override
    public String charge(Money amount) {
        if (!SUPPORTED_CURRENCIES.contains(amount.getCurrency())) {
            throw new IllegalArgumentException("PayPal does not support " + amount.getCurrency());
        }
        String reference = PaymentReference.next("PAYPAL");
        LOG.info(() -> "PayPal charge " + reference + " for " + amount + " (client " + clientId + ")");
        return reference;
    }
}
`,

  // ----- adapter/out/notification -----
  [`${M}adapter/out/notification/AbstractNotifier.java`]: j`package com.acme.shop.adapter.out.notification;

import com.acme.shop.application.port.out.NotificationPort;
import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Order;

/**
 * Template for all notification channels: formats the message and delivers it to the customer.
 */
public abstract class AbstractNotifier implements NotificationPort {

    @Override
    public void notify(Order order) {
        String message = format(order);
        deliver(order.getCustomer(), message);
    }

    protected abstract String format(Order order);

    protected abstract void deliver(Customer customer, String message);
}
`,

  [`${M}adapter/out/notification/EmailNotifier.java`]: j`package com.acme.shop.adapter.out.notification;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Order;
import com.acme.shop.util.StringUtils;
import java.util.logging.Logger;

public class EmailNotifier extends AbstractNotifier {

    private static final Logger LOG = Logger.getLogger(EmailNotifier.class.getName());

    private final String senderAddress;

    public EmailNotifier(String senderAddress) {
        this.senderAddress = senderAddress;
    }

    @Override
    protected String format(Order order) {
        return "Order " + order.getId() + " is now " + order.getStatus().name().toLowerCase()
                + " (" + order.getLines().size() + " items)";
    }

    @Override
    protected void deliver(Customer customer, String message) {
        if (StringUtils.isBlank(customer.getEmail())) {
            throw new IllegalStateException("Customer " + customer.getId() + " has no email address");
        }
        LOG.info(() -> "Email from " + senderAddress + " to " + StringUtils.maskEmail(customer.getEmail()) + ": " + message);
    }
}
`,

  [`${M}adapter/out/notification/SmsNotifier.java`]: j`package com.acme.shop.adapter.out.notification;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Order;
import com.acme.shop.util.StringUtils;
import java.util.logging.Logger;

public class SmsNotifier extends AbstractNotifier {

    private static final Logger LOG = Logger.getLogger(SmsNotifier.class.getName());
    private static final int MAX_SMS_LENGTH = 160;

    @Override
    protected String format(Order order) {
        return StringUtils.truncate("Acme: order " + order.getId() + " " + order.getStatus().name(), MAX_SMS_LENGTH);
    }

    @Override
    protected void deliver(Customer customer, String message) {
        if (StringUtils.isBlank(customer.getPhone())) {
            throw new IllegalStateException("Customer " + customer.getId() + " has no phone number");
        }
        LOG.info(() -> "SMS to " + customer.getPhone() + ": " + message);
    }
}
`,

  [`${M}adapter/out/notification/PushNotifier.java`]: j`package com.acme.shop.adapter.out.notification;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Order;
import java.util.logging.Logger;

public class PushNotifier extends AbstractNotifier {

    private static final Logger LOG = Logger.getLogger(PushNotifier.class.getName());

    @Override
    protected String format(Order order) {
        return "{\"orderId\":\"" + order.getId() + "\",\"status\":\"" + order.getStatus().name() + "\"}";
    }

    @Override
    protected void deliver(Customer customer, String message) {
        String deviceToken = "device-" + customer.getId();
        LOG.info(() -> "Push to " + deviceToken + ": " + message);
    }
}
`,

  [`${M}adapter/out/notification/LegacyFaxNotifier.java`]: j`package com.acme.shop.adapter.out.notification;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Order;
import java.util.logging.Logger;

/**
 * Fax channel used by a few wholesale customers.
 *
 * @deprecated fax gateway is being decommissioned
 */
@Deprecated
public class LegacyFaxNotifier extends AbstractNotifier {

    private static final Logger LOG = Logger.getLogger(LegacyFaxNotifier.class.getName());

    @Override
    protected String format(Order order) {
        return "ORDER " + order.getId() + " STATUS " + order.getStatus().name();
    }

    @Override
    protected void deliver(Customer customer, String message) {
        LOG.warning(() -> "FAX to " + customer.getPhone() + ": " + message);
    }
}
`,

  // ----- config -----
  [`${M}config/BeanConfig.java`]: j`package com.acme.shop.config;

import com.acme.shop.adapter.out.notification.EmailNotifier;
import com.acme.shop.adapter.out.payment.PaypalPaymentAdapter;
import com.acme.shop.adapter.out.payment.StripePaymentAdapter;
import com.acme.shop.application.port.in.CancelOrderUseCase;
import com.acme.shop.application.port.in.PlaceOrderUseCase;
import com.acme.shop.application.port.out.NotificationPort;
import com.acme.shop.application.port.out.OrderRepository;
import com.acme.shop.application.port.out.PaymentGateway;
import com.acme.shop.application.service.CancelOrderService;
import com.acme.shop.application.service.PlaceOrderService;
import com.acme.shop.domain.service.PricingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BeanConfig {

    @Bean
    public PricingService pricingService() {
        return new PricingService();
    }

    @Bean
    public PaymentGateway paymentGateway(
            @Value("${'$'}{shop.payment.provider}") String provider,
            @Value("${'$'}{shop.payment.api-key}") String apiKey) {
        if ("paypal".equalsIgnoreCase(provider)) {
            return new PaypalPaymentAdapter(apiKey);
        }
        return new StripePaymentAdapter(apiKey);
    }

    @Bean
    public NotificationPort notificationPort(@Value("${'$'}{shop.notification.sender}") String sender) {
        return new EmailNotifier(sender);
    }

    @Bean
    public PlaceOrderUseCase placeOrderUseCase(
            OrderRepository orderRepository,
            PaymentGateway paymentGateway,
            NotificationPort notificationPort,
            PricingService pricingService) {
        return new PlaceOrderService(orderRepository, paymentGateway, notificationPort, pricingService);
    }

    @Bean
    public CancelOrderUseCase cancelOrderUseCase(OrderRepository orderRepository, NotificationPort notificationPort) {
        return new CancelOrderService(orderRepository, notificationPort);
    }
}
`,

  // ----- util -----
  [`${M}util/StringUtils.java`]: j`package com.acme.shop.util;

import java.util.Locale;
import java.util.Objects;

/**
 * Small string helpers shared by adapters.
 */
public final class StringUtils {

    private StringUtils() {
    }

    public static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    public static String truncate(String value, int maxLength) {
        Objects.requireNonNull(value, "value");
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, Math.max(0, maxLength - 3)) + "...";
    }

    public static String maskEmail(String email) {
        if (isBlank(email) || !email.contains("@")) {
            return "***";
        }
        int at = email.indexOf('@');
        return email.charAt(0) + "***" + email.substring(at);
    }

    public static String toUpperSnake(String value) {
        return value.trim().replaceAll("[^A-Za-z0-9]+", "_").toUpperCase(Locale.ROOT);
    }
${LEGACY_PAD}}
`,

  [`${M}util/ReportGenerator.java`]: j`package com.acme.shop.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Formats plain-text tabular reports. Pure formatting, no I/O.
 */
public final class ReportGenerator {

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("dd.MM.yyyy");

    private ReportGenerator() {
    }

    public static String header(String title, LocalDate date) {
        return title + " - " + DATE_FORMAT.format(date);
    }

    public static String formatAmount(BigDecimal amount, String currency) {
        if (amount == null) {
            return "-";
        }
        return amount.setScale(2, RoundingMode.HALF_UP).toPlainString() + " " + currency;
    }

    public static String formatRow(List<String> cells, int columnWidth) {
        return cells.stream()
                .map(cell -> padRight(cell, columnWidth))
                .collect(Collectors.joining(" | "));
    }

    public static String formatTable(List<String> headers, List<List<String>> rows, int columnWidth) {
        StringBuilder builder = new StringBuilder();
        builder.append(formatRow(headers, columnWidth)).append('\n');
        builder.append("-".repeat(headers.size() * (columnWidth + 3))).append('\n');
        for (List<String> row : rows) {
            builder.append(formatRow(row, columnWidth)).append('\n');
        }
        return builder.toString();
    }

    private static String padRight(String value, int width) {
        String text = value == null ? "" : value;
        if (text.length() >= width) {
            return text.substring(0, width);
        }
        return text + " ".repeat(width - text.length());
    }
}
`,
};

const mainTestFiles = {
  [`${T}domain/model/OrderTest.java`]: j`package com.acme.shop.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class OrderTest {

    private Order newOrder() {
        return new Order("o-1", new Customer("c-1", "jane@example.com", "+100", false), "EUR");
    }

    @Test
    void shouldSumLineTotals_whenLinesAdded() {
        Order order = newOrder();
        order.addLine(new OrderLine("SKU-1", 2, Money.of("10.00", "EUR")));
        order.addLine(new OrderLine("SKU-2", 1, Money.of("5.50", "EUR")));

        assertThat(order.getTotal()).isEqualTo(Money.of("25.50", "EUR"));
    }

    @Test
    void shouldRejectNewLine_whenOrderIsPaid() {
        Order order = newOrder();
        order.addLine(new OrderLine("SKU-1", 1, Money.of("10.00", "EUR")));
        order.markPaid();

        assertThatThrownBy(() -> order.addLine(new OrderLine("SKU-2", 1, Money.of("1.00", "EUR"))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void shouldCancel_whenOrderIsNew() {
        Order order = newOrder();

        order.cancel();

        assertThat(order.isCancelled()).isTrue();
    }

    @Test
    void shouldNotCancel_whenOrderIsShipped() {
        Order order = newOrder();
        order.addLine(new OrderLine("SKU-1", 1, Money.of("10.00", "EUR")));
        order.markPaid();
        order.markShipped();

        assertThatThrownBy(order::cancel).isInstanceOf(IllegalStateException.class);
    }
}
`,

  [`${T}domain/model/MoneyTest.java`]: j`package com.acme.shop.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class MoneyTest {

    @Test
    void shouldAddAmounts_whenCurrenciesMatch() {
        Money sum = Money.of("10.25", "EUR").add(Money.of("4.75", "EUR"));

        assertThat(sum).isEqualTo(Money.of("15.00", "EUR"));
    }

    @Test
    void shouldBeEqual_whenAmountAndCurrencyMatch() {
        assertThat(Money.of("10", "EUR")).isEqualTo(Money.of("10.00", "EUR"));
        assertThat(Money.of("10", "EUR").hashCode()).isEqualTo(Money.of("10.00", "EUR").hashCode());
    }

    @Test
    void shouldNotBeEqual_whenCurrencyDiffers() {
        assertThat(Money.of("10.00", "EUR")).isNotEqualTo(Money.of("10.00", "USD"));
    }

    @Test
    void shouldRejectAddition_whenCurrencyDiffers() {
        assertThatThrownBy(() -> Money.of("1.00", "EUR").add(Money.of("1.00", "USD")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
`,

  [`${T}domain/service/PricingServiceTest.java`]: j`package com.acme.shop.domain.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;
import org.junit.jupiter.api.Test;

class PricingServiceTest {

    private final PricingService pricingService = new PricingService();

    private Order orderFor(boolean premium) {
        return new Order("o-1", new Customer("c-1", "jane@example.com", "+100", premium), "EUR");
    }

    @Test
    void shouldApplyPremiumDiscount_whenCustomerIsPremium() {
        Order order = orderFor(true);
        order.addLine(new OrderLine("SKU-1", 1, Money.of("100.00", "EUR")));

        assertThat(pricingService.calculateTotal(order)).isEqualTo(Money.of("90.00", "EUR"));
    }

    @Test
    void shouldApplyBulkDiscount_whenQuantityReachesThreshold() {
        Order order = orderFor(false);
        order.addLine(new OrderLine("SKU-1", 10, Money.of("5.00", "EUR")));

        assertThat(pricingService.calculateTotal(order)).isEqualTo(Money.of("47.50", "EUR"));
    }

    @Test
    void shouldReturnZero_whenOrderHasNoLines() {
        assertThat(pricingService.calculateTotal(orderFor(false))).isEqualTo(Money.zero("EUR"));
    }

    @Test
    void shouldChargeShipping_whenTotalIsBelowThreshold() {
        Order order = orderFor(false);
        order.addLine(new OrderLine("SKU-1", 1, Money.of("50.00", "EUR")));

        assertThat(pricingService.shippingCost(order)).isEqualTo(Money.of("4.99", "EUR"));
    }
}
`,

  [`${T}application/service/PlaceOrderServiceTest.java`]: j`package com.acme.shop.application.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.shop.application.port.in.PlaceOrderCommand;
import com.acme.shop.application.port.out.NotificationPort;
import com.acme.shop.application.port.out.OrderRepository;
import com.acme.shop.application.port.out.PaymentGateway;
import com.acme.shop.domain.exception.InvalidOrderException;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderStatus;
import com.acme.shop.domain.service.PricingService;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PlaceOrderServiceTest {

    private OrderRepository orderRepository;
    private PaymentGateway paymentGateway;
    private NotificationPort notificationPort;
    private PlaceOrderService service;

    @BeforeEach
    void setUp() {
        orderRepository = mock(OrderRepository.class);
        paymentGateway = mock(PaymentGateway.class);
        notificationPort = mock(NotificationPort.class);
        service = new PlaceOrderService(orderRepository, paymentGateway, notificationPort, new PricingService());
        when(orderRepository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private PlaceOrderCommand command(List<PlaceOrderCommand.Line> lines) {
        return new PlaceOrderCommand("c-1", "jane@example.com", "+100", false, "EUR", "card", lines);
    }

    @Test
    void shouldChargeAndPersistOrder_whenCommandIsValid() {
        Order order = service.placeOrder(command(List.of(
                new PlaceOrderCommand.Line("SKU-1", 2, new BigDecimal("10.00")),
                new PlaceOrderCommand.Line("SKU-2", 1, new BigDecimal("20.00")))));

        assertThat(order.getStatus()).isEqualTo(OrderStatus.PAID);
        assertThat(order.getTotal()).isEqualTo(Money.of("40.00", "EUR"));
        verify(paymentGateway).charge(Money.of("40.00", "EUR"));
        verify(notificationPort).notify(order);
    }

    @Test
    void shouldRejectOrder_whenCommandHasNoLines() {
        assertThatThrownBy(() -> service.placeOrder(command(List.of())))
                .isInstanceOf(InvalidOrderException.class);

        verify(paymentGateway, never()).charge(any(Money.class));
    }
}
`,

  [`${T}adapter/in/web/OrderControllerTest.java`]: j`package com.acme.shop.adapter.in.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.shop.application.port.in.CancelOrderUseCase;
import com.acme.shop.application.port.in.PlaceOrderUseCase;
import com.acme.shop.domain.model.Customer;
import com.acme.shop.domain.model.Money;
import com.acme.shop.domain.model.Order;
import com.acme.shop.domain.model.OrderLine;
import com.acme.shop.domain.service.PricingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OrderController.class)
class OrderControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private PlaceOrderUseCase placeOrderUseCase;

    @MockBean
    private CancelOrderUseCase cancelOrderUseCase;

    @MockBean
    private PricingService pricingService;

    @Test
    void shouldReturnCreated_whenOrderIsPlaced() throws Exception {
        Order order = new Order("o-1", new Customer("c-1", "jane@example.com", "+100", false), "EUR");
        order.addLine(new OrderLine("SKU-1", 1, Money.of("10.00", "EUR")));
        when(placeOrderUseCase.placeOrder(any())).thenReturn(order);
        OrderRequest request = new OrderRequest("c-1", "jane@example.com", "+100", false, "EUR", "card",
                List.of(new OrderRequest.LineRequest("SKU-1", 1, new BigDecimal("10.00"))));

        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("o-1"));
    }

    @Test
    void shouldReturnNoContent_whenOrderIsCancelled() throws Exception {
        mockMvc.perform(delete("/api/orders/o-1"))
                .andExpect(status().isNoContent());

        verify(cancelOrderUseCase).cancelOrder("o-1");
    }
}
`,
};

// ---------------------------------------------------------------------------
// feature/ai-refactor
// ---------------------------------------------------------------------------

/** Commit 1: ödeme portu idempotency anahtarı, doğrulamanın taşınması, getTotal -> totalAmount, DTO paketi. */
function aiRefactorCommit1(s) {
  // (1) PaymentGateway.charge(Money) -> charge(Money, String)
  edit(s, `${M}application/port/out/PaymentGateway.java`,
    j`    /**
     * Charges the given amount and returns the provider transaction reference.
     */
    String charge(Money amount);`,
    j`    /**
     * Charges the given amount and returns the provider transaction reference.
     * Repeated calls with the same idempotency key must not charge twice.
     */
    String charge(Money amount, String idempotencyKey);`);

  edit(s, `${M}adapter/out/payment/StripePaymentAdapter.java`,
    j`import java.util.logging.Logger;`,
    j`import java.util.Objects;
import java.util.logging.Logger;`);
  edit(s, `${M}adapter/out/payment/StripePaymentAdapter.java`,
    j`    public String charge(Money amount) {
        if (amount.getAmount().signum() <= 0) {
            throw new IllegalArgumentException("Charge amount must be positive");
        }
        String reference = PaymentReference.next("STRIPE");
        LOG.info(() -> "Stripe charge " + reference + " for " + amount + " using key " + apiKey.substring(0, 4) + "***");`,
    j`    public String charge(Money amount, String idempotencyKey) {
        if (amount.getAmount().signum() <= 0) {
            throw new IllegalArgumentException("Charge amount must be positive");
        }
        Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        String reference = PaymentReference.next("STRIPE");
        LOG.info(() -> "Stripe charge " + reference + " (key " + idempotencyKey + ") for " + amount
                + " using key " + apiKey.substring(0, 4) + "***");`);

  edit(s, `${M}adapter/out/payment/PaypalPaymentAdapter.java`,
    j`    public String charge(Money amount) {
        if (!SUPPORTED_CURRENCIES.contains(amount.getCurrency())) {
            throw new IllegalArgumentException("PayPal does not support " + amount.getCurrency());
        }
        String reference = PaymentReference.next("PAYPAL");
        LOG.info(() -> "PayPal charge " + reference + " for " + amount + " (client " + clientId + ")");`,
    j`    public String charge(Money amount, String idempotencyKey) {
        if (!SUPPORTED_CURRENCIES.contains(amount.getCurrency())) {
            throw new IllegalArgumentException("PayPal does not support " + amount.getCurrency());
        }
        String reference = PaymentReference.next("PAYPAL");
        LOG.info(() -> "PayPal charge " + reference + " (request " + idempotencyKey + ") for " + amount
                + " (client " + clientId + ")");`);

  // (6) validate -> OrderValidator (domain/service), (1) çağrı güncellenir
  const pos = `${M}application/service/PlaceOrderService.java`;
  edit(s, pos,
    j`import com.acme.shop.domain.exception.InvalidOrderException;
`, '');
  edit(s, pos,
    j`import com.acme.shop.domain.model.OrderLine;
import com.acme.shop.domain.service.PricingService;`,
    j`import com.acme.shop.domain.model.OrderLine;
import com.acme.shop.domain.service.OrderValidator;
import com.acme.shop.domain.service.PricingService;`);
  edit(s, pos,
    j`    private final PricingService pricingService;
`,
    j`    private final PricingService pricingService;
    private final OrderValidator orderValidator = new OrderValidator();
`);
  edit(s, pos,
    j`        validate(command);`,
    j`        orderValidator.validate(command);`);
  edit(s, pos,
    j`        paymentGateway.charge(amount);`,
    j`        paymentGateway.charge(amount, order.getId());`);
  edit(s, pos,
    j`

    private void validate${VALIDATE_BODY}`, '');

  s[`${M}domain/service/OrderValidator.java`] = j`package com.acme.shop.domain.service;

import com.acme.shop.application.port.in.PlaceOrderCommand;
import com.acme.shop.domain.exception.InvalidOrderException;

/**
 * Business validation for incoming orders.
 */
public class OrderValidator {

    public void validate${VALIDATE_BODY}
}
`;

  // (11) yeni sınıfın testi
  s[`${T}domain/service/OrderValidatorTest.java`] = j`package com.acme.shop.domain.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.shop.application.port.in.PlaceOrderCommand;
import com.acme.shop.domain.exception.InvalidOrderException;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class OrderValidatorTest {

    private final OrderValidator validator = new OrderValidator();

    private PlaceOrderCommand command(String currency, List<PlaceOrderCommand.Line> lines) {
        return new PlaceOrderCommand("c-1", "jane@example.com", "+100", false, currency, "card", lines);
    }

    @Test
    void shouldAccept_whenCommandIsValid() {
        PlaceOrderCommand command = command("EUR", List.of(new PlaceOrderCommand.Line("SKU-1", 1, new BigDecimal("9.99"))));

        assertThatCode(() -> validator.validate(command)).doesNotThrowAnyException();
    }

    @Test
    void shouldReject_whenCommandHasNoLines() {
        assertThatThrownBy(() -> validator.validate(command("EUR", List.of())))
                .isInstanceOf(InvalidOrderException.class);
    }

    @Test
    void shouldReject_whenQuantityIsNotPositive() {
        PlaceOrderCommand command = command("EUR", List.of(new PlaceOrderCommand.Line("SKU-1", 0, new BigDecimal("9.99"))));

        assertThatThrownBy(() -> validator.validate(command))
                .isInstanceOf(InvalidOrderException.class)
                .hasMessageContaining("SKU-1");
    }

    @Test
    void shouldReject_whenCurrencyIsBlank() {
        PlaceOrderCommand command = command(" ", List.of(new PlaceOrderCommand.Line("SKU-1", 1, new BigDecimal("9.99"))));

        assertThatThrownBy(() -> validator.validate(command)).isInstanceOf(InvalidOrderException.class);
    }
}
`;

  // (5) Order.getTotal() -> Order.totalAmount(); tüm çağıranlar
  edit(s, `${M}domain/model/Order.java`, j`    public Money getTotal() {`, j`    public Money totalAmount() {`);
  edit(s, `${M}domain/service/PricingService.java`, j`        Money total = order.getTotal();`, j`        Money total = order.totalAmount();`);
  edit(s, `${M}domain/service/PricingService.java`, j`        if (order.getTotal().isGreaterThan(`, j`        if (order.totalAmount().isGreaterThan(`);
  edit(s, `${M}adapter/out/persistence/OrderMapper.java`, j`order.getTotal().getAmount()`, j`order.totalAmount().getAmount()`);
  edit(s, `${M}adapter/in/web/OrderResponse.java`, j`order.getTotal().getAmount()`, j`order.totalAmount().getAmount()`);
  edit(s, `${T}domain/model/OrderTest.java`, j`assertThat(order.getTotal())`, j`assertThat(order.totalAmount())`);

  const pst = `${T}application/service/PlaceOrderServiceTest.java`;
  edit(s, pst, j`assertThat(order.getTotal())`, j`assertThat(order.totalAmount())`);
  edit(s, pst, j`import static org.mockito.ArgumentMatchers.any;
`, j`import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
`);
  edit(s, pst, j`verify(paymentGateway).charge(Money.of("40.00", "EUR"));`, j`verify(paymentGateway).charge(Money.of("40.00", "EUR"), order.getId());`);
  edit(s, pst, j`verify(paymentGateway, never()).charge(any(Money.class));`, j`verify(paymentGateway, never()).charge(any(Money.class), anyString());`);

  // (13) OrderRequest -> adapter/in/web/dto/OrderRequest
  rename(s, `${M}adapter/in/web/OrderRequest.java`, `${M}adapter/in/web/dto/OrderRequest.java`);
  edit(s, `${M}adapter/in/web/dto/OrderRequest.java`, j`package com.acme.shop.adapter.in.web;`, j`package com.acme.shop.adapter.in.web.dto;`);
  edit(s, `${M}adapter/in/web/OrderController.java`,
    j`package com.acme.shop.adapter.in.web;

`,
    j`package com.acme.shop.adapter.in.web;

import com.acme.shop.adapter.in.web.dto.OrderRequest;
`);
  edit(s, `${T}adapter/in/web/OrderControllerTest.java`,
    j`import com.acme.shop.application.port.in.CancelOrderUseCase;`,
    j`import com.acme.shop.adapter.in.web.dto.OrderRequest;
import com.acme.shop.application.port.in.CancelOrderUseCase;`);
}

/** Commit 2: bildirim retry + kanal adı, yeni fiyat kuralı, fax kanalının kaldırılması, build/config. */
function aiRefactorCommit2(s) {
  // (3) template method gövdesi + (4) yeni abstract metot + printStackTrace
  edit(s, `${M}adapter/out/notification/AbstractNotifier.java`,
    j`public abstract class AbstractNotifier implements NotificationPort {

    @Override
    public void notify(Order order) {
        String message = format(order);
        deliver(order.getCustomer(), message);
    }

    protected abstract String format(Order order);`,
    j`public abstract class AbstractNotifier implements NotificationPort {

    private static final int MAX_ATTEMPTS = 3;

    @Override
    public void notify(Order order) {
        String message = "[" + channelName() + "] " + format(order);
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                deliver(order.getCustomer(), message);
                return;
            } catch (RuntimeException e) {
                e.printStackTrace();
                if (attempt == MAX_ATTEMPTS) {
                    throw e;
                }
            }
        }
    }

    protected abstract String channelName();

    protected abstract String format(Order order);`);

  const channel = (name) => j`    @Override
    protected String channelName() {
        return "${name}";
    }

    @Override
    protected String format(Order order) {`;
  const formatAnchor = j`    @Override
    protected String format(Order order) {`;
  edit(s, `${M}adapter/out/notification/EmailNotifier.java`, formatAnchor, channel('email'));
  edit(s, `${M}adapter/out/notification/SmsNotifier.java`, formatAnchor, channel('sms'));
  edit(s, `${M}adapter/out/notification/PushNotifier.java`, formatAnchor, channel('push'));

  // (12) dosya silme
  delete s[`${M}adapter/out/notification/LegacyFaxNotifier.java`];

  // (2) yeni indirim kuralı; OrderController.quote değişmez
  const ps = `${M}domain/service/PricingService.java`;
  edit(s, ps,
    j`    static final int BULK_QUANTITY_THRESHOLD = 10;
`,
    j`    static final int BULK_QUANTITY_THRESHOLD = 10;
    static final int HIGH_VALUE_DISCOUNT_PERCENT = 3;
    static final String HIGH_VALUE_THRESHOLD = "500.00";
`);
  edit(s, ps,
    j`            discount = discount.add(total.percentage(BULK_DISCOUNT_PERCENT));
        }
        return total.subtract(discount);`,
    j`            discount = discount.add(total.percentage(BULK_DISCOUNT_PERCENT));
        }
        if (total.isGreaterThan(Money.of(HIGH_VALUE_THRESHOLD, order.getCurrency()))) {
            discount = discount.add(total.percentage(HIGH_VALUE_DISCOUNT_PERCENT));
        }
        return total.subtract(discount);`);

  // (12) Java dışı
  edit(s, 'pom.xml',
    `        <dependency>
            <groupId>com.h2database</groupId>`,
    `        <dependency>
            <groupId>org.springframework.retry</groupId>
            <artifactId>spring-retry</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>`);
  edit(s, 'src/main/resources/application.yml', '      ddl-auto: validate', '      ddl-auto: update');
}

/** Commit 3: util temizliği, persistence ve controller değişiklikleri, riskli/mimari ihlal içeren dokunuşlar. */
function aiRefactorCommit3(s) {
  // (7) kozmetik + (10) legacyPad silinir (PaymentReference çağırmaya devam eder)
  const su = `${M}util/StringUtils.java`;
  s[su] = cosmeticReformat(s[su].replace(LEGACY_PAD, ''));
  const rg = `${M}util/ReportGenerator.java`;
  s[rg] = cosmeticReformat(s[rg]);

  // (8) riskli değişiklikler
  const cos = `${M}application/service/CancelOrderService.java`;
  edit(s, cos,
    j`import com.acme.shop.domain.model.Order;
`,
    j`import com.acme.shop.domain.model.Order;
import org.springframework.transaction.annotation.Transactional;
`);
  edit(s, cos,
    j`    @Override
    public void cancelOrder(String orderId) {`,
    j`    @Override
    @Transactional
    public void cancelOrder(String orderId) {`);

  const money = `${M}domain/model/Money.java`;
  edit(s, money,
    j`        return amount.compareTo(other.amount) == 0 && currency.equals(other.currency);`,
    j`        return amount.compareTo(other.amount) == 0;`);
  edit(s, money,
    j`        return Objects.hash(amount.stripTrailingZeros(), currency);`,
    j`        return Objects.hash(amount.stripTrailingZeros());`);

  edit(s, `${M}adapter/out/persistence/OrderPersistenceAdapter.java`,
    j`    public Optional<Order> findById(String id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }`,
    j`    public Optional<Order> findById(String id) {
        try {
            return jpaRepository.findById(id).map(mapper::toDomain);
        } catch (Exception e) {
        }
        return Optional.empty();
    }`);

  const jpa = `${M}adapter/out/persistence/OrderJpaRepository.java`;
  edit(s, jpa,
    j`import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;`,
    j`import java.math.BigDecimal;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;`);
  edit(s, jpa,
    j`    List<OrderEntity> findByCustomerId(String customerId);
`,
    j`    List<OrderEntity> findByCustomerId(String customerId);

    @Query("SELECT o FROM OrderEntity o WHERE o.status = :status AND o.totalAmount > :minTotal ORDER BY o.totalAmount DESC")
    List<OrderEntity> findLargeOrdersByStatus(@Param("status") String status, @Param("minTotal") BigDecimal minTotal);
`);

  // (9) mimari ihlaller
  const order = `${M}domain/model/Order.java`;
  edit(s, order,
    j`import java.util.Objects;
`,
    j`import java.util.Objects;
import org.springframework.stereotype.Component;
`);
  edit(s, order,
    j` * Order aggregate root.
 */
public class Order {`,
    j` * Order aggregate root.
 */
@Component
public class Order {`);

  const ctrl = `${M}adapter/in/web/OrderController.java`;
  edit(s, ctrl,
    j`import com.acme.shop.application.port.in.PlaceOrderUseCase;
`,
    j`import com.acme.shop.application.port.in.PlaceOrderUseCase;
import com.acme.shop.application.service.PlaceOrderService;
`);
  edit(s, ctrl,
    j`import jakarta.validation.Valid;
import java.util.Map;
`,
    j`import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
`);
  edit(s, ctrl,
    j`    private final PricingService pricingService;
`,
    j`    private final PricingService pricingService;

    @Autowired
    private PlaceOrderService placeOrderService;
`);
  edit(s, ctrl,
    j`    @PostMapping("/quote")`,
    j`    @PostMapping("/express")
    public ResponseEntity<OrderResponse> placeExpressOrder(@Valid @RequestBody OrderRequest request) {
        Order order = placeOrderService.placeOrder(request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED).body(OrderResponse.from(order));
    }

    @PostMapping("/quote")`);
}

/** feature/small-fix: zaten iptal edilmiş siparişte tekrar kaydetme/bildirim yapılmasın. */
function smallFixCommit(s) {
  edit(s, `${M}application/service/CancelOrderService.java`,
    j`                .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.cancel();`,
    j`                .orElseThrow(() -> new OrderNotFoundException(orderId));
        if (order.isCancelled()) {
            return;
        }
        order.cancel();`);
}

// ---------------------------------------------------------------------------
// Çalıştır
// ---------------------------------------------------------------------------

function main() {
  const expected = join(ROOT, 'fixtures', 'sample-repo');
  if (!REPO.endsWith(`fixtures${sep}sample-repo`) || REPO !== expected) {
    throw new Error(`Beklenmeyen hedef yol: ${REPO}`);
  }
  if (existsSync(REPO)) rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });

  git('init', '-q', '-b', 'main');

  // main
  let state = {};
  state = commit(state, { ...mainFiles }, 'Initial shop service with hexagonal layout');
  state = commit(state, { ...state, ...mainTestFiles }, 'Add unit and web tests');
  const mainState = state;

  // feature/ai-refactor
  git('checkout', '-q', '-b', 'feature/ai-refactor', 'main');
  let next = { ...mainState };
  aiRefactorCommit1(next);
  state = commit(mainState, next, 'Refactor payments to idempotent charges and extract order validation');
  next = { ...state };
  aiRefactorCommit2(next);
  state = commit(state, next, 'Add notification retries, channel names and high-value discount');
  next = { ...state };
  aiRefactorCommit3(next);
  state = commit(state, next, 'Clean up utils, persistence and controller wiring');

  // feature/small-fix
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'feature/small-fix', 'main');
  next = { ...mainState };
  smallFixCommit(next);
  commit(mainState, next, 'Skip repeated cancellation of already cancelled orders');

  git('checkout', '-q', 'main');

  // Özet
  console.log(`Fikstür deposu hazır: ${REPO}`);
  for (const branch of ['main', 'feature/ai-refactor', 'feature/small-fix']) {
    const count = git('rev-list', '--count', branch);
    const sha = git('rev-parse', branch);
    const files = branch === 'main' ? git('ls-tree', '-r', '--name-only', 'main').split('\n').length : null;
    const changed = branch === 'main' ? null : git('diff', '--name-only', `main...${branch}`).split('\n').filter(Boolean).length;
    const extra = branch === 'main' ? `${files} dosya` : `main...${branch}: ${changed} dosya değişti`;
    console.log(`  ${branch.padEnd(20)} ${sha}  ${count} commit  (${extra})`);
  }
}

main();
