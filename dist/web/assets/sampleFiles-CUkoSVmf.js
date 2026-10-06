import{n as e}from"./rolldown-runtime-hePW80VL.js";var t=`src/main/java/com/shop/`,n=`src/test/java/com/shop/`,r={paymentGateway:`${t}domain/payment/PaymentGateway.java`,paymentResult:`${t}domain/payment/PaymentResult.java`,paymentException:`${t}domain/payment/PaymentException.java`,stripe:`${t}adapter/out/payment/StripePaymentGateway.java`,iyzico:`${t}adapter/out/payment/IyzicoPaymentGateway.java`,placeOrder:`${t}application/PlaceOrderService.java`,orderValidator:`${t}application/OrderValidator.java`,order:`${t}domain/order/Order.java`,money:`${t}domain/money/Money.java`,notifier:`${t}application/notification/AbstractNotifier.java`,cancelOrder:`${t}application/CancelOrderService.java`,stringUtils:`${t}util/StringUtils.java`,legacyFormatter:`${t}util/LegacyMoneyFormatter.java`,reportGenerator:`${t}adapter/out/report/ReportGenerator.java`,orderController:`${t}adapter/in/web/OrderController.java`,placeOrderTest:`${n}application/PlaceOrderServiceTest.java`,pom:`pom.xml`,appYml:`src/main/resources/application.yml`,migration:`src/main/resources/db/migration/V7__payment_idempotency.sql`,messagesOld:`src/main/resources/messages.properties`,messages:`src/main/resources/i18n/messages_tr.properties`,emailNotifier:`${t}adapter/out/notification/EmailNotifier.java`,smsNotifier:`${t}adapter/out/notification/SmsNotifier.java`,pushNotifier:`${t}adapter/out/notification/PushNotifier.java`,eventListener:`${t}application/notification/OrderEventListener.java`,invoicePrinter:`${t}adapter/out/report/InvoicePrinter.java`,refundService:`${t}application/RefundService.java`,moneyTest:`${n}domain/money/MoneyTest.java`};function i(e,...t){return String.raw({raw:e},...t).replace(/^\n/,``)}var a=i`
package com.shop.domain.payment;

import com.shop.domain.money.Money;

/**
 * Outbound port to the payment provider.
 */
public interface PaymentGateway {

    /**
     * Charges the customer.
     *
     * @return true if the charge succeeded
     */
    boolean charge(Money amount, String customerId);

    void refund(String transactionId);
}
`,o=i`
package com.shop.domain.payment;

import com.shop.domain.money.Money;

/**
 * Outbound port to the payment provider.
 */
public interface PaymentGateway {

    /**
     * Charges the customer.
     *
     * @param idempotencyKey prevents charging the same order twice
     * @return the provider's transaction result
     * @throws PaymentException if the provider rejects the request
     */
    PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException;

    void refund(String transactionId);
}
`,s=i`
package com.shop.domain.payment;

public record PaymentResult(String transactionId, boolean approved, String failureReason) {

    public static PaymentResult success(String transactionId) {
        return new PaymentResult(transactionId, true, null);
    }

    public static PaymentResult failure(String reason) {
        return new PaymentResult(null, false, reason);
    }
}
`,c=i`
package com.shop.domain.payment;

public class PaymentException extends Exception {

    private final String providerCode;

    public PaymentException(String message, String providerCode) {
        super(message);
        this.providerCode = providerCode;
    }

    public String getProviderCode() {
        return providerCode;
    }
}
`,l=i`
package com.shop.adapter.out.payment;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;
import com.stripe.exception.StripeException;
import com.stripe.model.Charge;
import com.stripe.param.ChargeCreateParams;
import org.springframework.stereotype.Component;

@Component
public class StripePaymentGateway implements PaymentGateway {

    private final StripeClientFactory clients;

    public StripePaymentGateway(StripeClientFactory clients) {
        this.clients = clients;
    }

    @Override
    public boolean charge(Money amount, String customerId) {
        try {
            ChargeCreateParams params = ChargeCreateParams.builder()
                    .setAmount(amount.toMinorUnits())
                    .setCurrency(amount.currency().getCurrencyCode())
                    .setCustomer(customerId)
                    .build();
            Charge charge = clients.client().charges().create(params);
            return "succeeded".equals(charge.getStatus());
        } catch (StripeException e) {
            return false;
        }
    }

    @Override
    public void refund(String transactionId) {
        clients.client().refunds().create(transactionId);
    }
}
`,u=i`
package com.shop.adapter.out.payment;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.Charge;
import com.stripe.net.RequestOptions;
import com.stripe.param.ChargeCreateParams;
import org.springframework.stereotype.Component;

@Component
public class StripePaymentGateway implements PaymentGateway {

    private final StripeClientFactory clients;

    public StripePaymentGateway(StripeClientFactory clients) {
        this.clients = clients;
    }

    @Override
    public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException {
        ChargeCreateParams params = ChargeCreateParams.builder()
                .setAmount(amount.toMinorUnits())
                .setCurrency(amount.currency().getCurrencyCode())
                .setCustomer(customerId)
                .build();
        RequestOptions options = RequestOptions.builder()
                .setIdempotencyKey(idempotencyKey)
                .build();
        try {
            Charge charge = clients.client().charges().create(params, options);
            if ("succeeded".equals(charge.getStatus())) {
                return PaymentResult.success(charge.getId());
            }
            return PaymentResult.failure(charge.getFailureMessage());
        } catch (CardException e) {
            return PaymentResult.failure(e.getDeclineCode());
        } catch (StripeException e) {
            throw new PaymentException("Stripe request failed: " + e.getMessage(), e.getCode());
        }
    }

    @Override
    public void refund(String transactionId) {
        clients.client().refunds().create(transactionId);
    }
}
`,d=i`
package com.shop.adapter.out.payment;

import com.iyzipay.Options;
import com.iyzipay.model.Payment;
import com.iyzipay.model.Status;
import com.iyzipay.request.CreatePaymentRequest;
import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;

public class IyzicoPaymentGateway implements PaymentGateway {

    private final Options options;

    public IyzicoPaymentGateway(Options options) {
        this.options = options;
    }

    @Override
    public boolean charge(Money amount, String customerId) {
        CreatePaymentRequest request = new CreatePaymentRequest();
        request.setPrice(amount.value());
        request.setPaidPrice(amount.value());
        request.setCurrency(amount.currency().getCurrencyCode());
        request.setBuyerId(customerId);
        Payment payment = Payment.create(request, options);
        return Status.SUCCESS.getValue().equals(payment.getStatus());
    }

    @Override
    public void refund(String transactionId) {
        throw new UnsupportedOperationException("Iyzico refunds are not supported yet");
    }
}
`,f=i`
package com.shop.adapter.out.payment;

import com.iyzipay.Options;
import com.iyzipay.model.Payment;
import com.iyzipay.model.Status;
import com.iyzipay.request.CreatePaymentRequest;
import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;

public class IyzicoPaymentGateway implements PaymentGateway {

    private final Options options;

    public IyzicoPaymentGateway(Options options) {
        this.options = options;
    }

    @Override
    public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException {
        CreatePaymentRequest request = new CreatePaymentRequest();
        request.setConversationId(idempotencyKey);
        request.setPrice(amount.value());
        request.setPaidPrice(amount.value());
        request.setCurrency(amount.currency().getCurrencyCode());
        request.setBuyerId(customerId);
        Payment payment = Payment.create(request, options);
        if (Status.SUCCESS.getValue().equals(payment.getStatus())) {
            return PaymentResult.success(payment.getPaymentId());
        }
        return PaymentResult.failure(payment.getErrorMessage());
    }

    @Override
    public void refund(String transactionId) {
        throw new UnsupportedOperationException("Iyzico refunds are not supported yet");
    }
}
`,p=i`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlaceOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public PlaceOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    @Transactional
    public Order place(Order order) {
        validate(order);
        Money total = order.getTotal();
        boolean paid = payments.charge(total, order.customerId());
        if (!paid) {
            throw new IllegalStateException("Payment failed for order " + order.id());
        }
        order.markPaid();
        return orders.save(order);
    }

    private void validate(Order order) {
        if (order.lines().isEmpty()) {
            throw new IllegalArgumentException("Order has no lines");
        }
        for (OrderLine line : order.lines()) {
            if (line.quantity() <= 0) {
                throw new IllegalArgumentException("Invalid quantity for " + line.sku());
            }
        }
    }
}
`,m=i`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlaceOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;
    private final OrderValidator validator;

    public PlaceOrderService(OrderRepository orders, PaymentGateway payments, OrderValidator validator) {
        this.orders = orders;
        this.payments = payments;
        this.validator = validator;
    }

    @Transactional
    public Order place(Order order) {
        validator.validate(order);
        Money total = order.totalAmount();
        PaymentResult result;
        try {
            result = payments.charge(total, order.customerId(), order.id().toString());
        } catch (PaymentException e) {
            throw new IllegalStateException("Payment failed for order " + order.id(), e);
        }
        if (!result.approved()) {
            throw new IllegalStateException("Payment declined for order " + order.id() + ": " + result.failureReason());
        }
        order.markPaid();
        return orders.save(order);
    }
}
`,h=i`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import org.springframework.stereotype.Component;

@Component
public class OrderValidator {

    public void validate(Order order) {
        if (order.lines().isEmpty()) {
            throw new IllegalArgumentException("Order has no lines");
        }
        for (OrderLine line : order.lines()) {
            if (line.quantity() <= 0) {
                throw new IllegalArgumentException("Invalid quantity for " + line.sku());
            }
        }
    }
}
`,g=i`
package com.shop.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.order.OrderStatus;
import com.shop.domain.payment.PaymentGateway;
import org.junit.jupiter.api.Test;

class PlaceOrderServiceTest {

    private final OrderRepository orders = mock(OrderRepository.class);
    private final PaymentGateway payments = mock(PaymentGateway.class);
    private final PlaceOrderService service = new PlaceOrderService(orders, payments);

    @Test
    void placesPaidOrder() {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString())).thenReturn(true);
        when(orders.save(order)).thenReturn(order);

        assertThat(service.place(order).status()).isEqualTo(OrderStatus.PAID);
    }

    @Test
    void rejectsFailedPayment() {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString())).thenReturn(false);

        assertThatThrownBy(() -> service.place(order)).isInstanceOf(IllegalStateException.class);
    }
}
`,_=i`
package com.shop.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.order.OrderStatus;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import org.junit.jupiter.api.Test;

class PlaceOrderServiceTest {

    private final OrderRepository orders = mock(OrderRepository.class);
    private final PaymentGateway payments = mock(PaymentGateway.class);
    private final PlaceOrderService service = new PlaceOrderService(orders, payments, new OrderValidator());

    @Test
    void placesPaidOrder() throws Exception {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString(), anyString())).thenReturn(PaymentResult.success("tx-1"));
        when(orders.save(order)).thenReturn(order);

        assertThat(service.place(order).status()).isEqualTo(OrderStatus.PAID);
    }

    @Test
    void rejectsDeclinedPayment() throws Exception {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString(), anyString())).thenReturn(PaymentResult.failure("insufficient_funds"));

        assertThatThrownBy(() -> service.place(order)).isInstanceOf(IllegalStateException.class);
    }
}
`,v=i`
package com.shop.domain.order;

import com.shop.domain.money.Money;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class Order {

    private final UUID id;
    private final String customerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;

    public Order(UUID id, String customerId) {
        this.id = id;
        this.customerId = customerId;
    }

    public UUID id() {
        return id;
    }

    public String customerId() {
        return customerId;
    }

    public List<OrderLine> lines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public Money getTotal() {
        return lines.stream()
                .map(OrderLine::subtotal)
                .reduce(Money.ZERO, Money::plus);
    }

    public void markPaid() {
        status = OrderStatus.PAID;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Shipped orders cannot be cancelled");
        }
        status = OrderStatus.CANCELLED;
    }

    public OrderStatus status() {
        return status;
    }
}
`,y=i`
package com.shop.domain.order;

import com.shop.domain.money.Money;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.util.Assert;

public class Order {

    private final UUID id;
    private final String customerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;

    public Order(UUID id, String customerId) {
        Assert.hasText(customerId, "customerId is required");
        this.id = id;
        this.customerId = customerId;
    }

    public UUID id() {
        return id;
    }

    public String customerId() {
        return customerId;
    }

    public List<OrderLine> lines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public Money totalAmount() {
        return lines.stream()
                .map(OrderLine::subtotal)
                .reduce(Money.ZERO, Money::plus);
    }

    public void markPaid() {
        status = OrderStatus.PAID;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Shipped orders cannot be cancelled");
        }
        status = OrderStatus.CANCELLED;
    }

    public OrderStatus status() {
        return status;
    }
}
`,b=i`
package com.shop.domain.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Objects;

public final class Money {

    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.getInstance("TRY"));

    private final BigDecimal value;
    private final Currency currency;

    public Money(BigDecimal value, Currency currency) {
        this.value = value.setScale(2, RoundingMode.HALF_EVEN);
        this.currency = currency;
    }

    public BigDecimal value() {
        return value;
    }

    public Currency currency() {
        return currency;
    }

    public long toMinorUnits() {
        return value.movePointRight(2).longValueExact();
    }

    public Money plus(Money other) {
        return new Money(value.add(other.value), currency);
    }

    public Money negate() {
        return new Money(value.negate(), currency);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money other)) return false;
`,x=i`
    }

    @Override
    public int hashCode() {
        return Objects.hash(value, currency);
    }
}
`,S=`${b}        return value.equals(other.value) && currency.equals(other.currency);\n${x}`,C=`${b}        return value.compareTo(other.value) == 0;\n${x}`,w=i`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractNotifier {

    private static final Logger log = LoggerFactory.getLogger(AbstractNotifier.class);

    public final void notify(OrderEvent event) {
        String message = format(event);
        send(event.recipient(), message);
        log.debug("Notification sent for order {}", event.orderId());
    }

    protected abstract String format(OrderEvent event);

    protected abstract void send(String recipient, String message);
}
`,T=i`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractNotifier {

    private static final Logger log = LoggerFactory.getLogger(AbstractNotifier.class);

    public final void notify(OrderEvent event) {
        if (!supports(event)) {
            log.debug("Skipping {} for order {}", getClass().getSimpleName(), event.orderId());
            return;
        }
        String message = format(event);
        try {
            send(event.recipient(), message);
        } catch (RuntimeException e) {
            log.warn("Notification failed for order {}", event.orderId(), e);
        }
    }

    protected boolean supports(OrderEvent event) {
        return event.recipient() != null && !event.recipient().isBlank();
    }

    protected abstract String format(OrderEvent event);

    protected abstract void send(String recipient, String message);
}
`,E=i`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CancelOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public CancelOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    public void cancel(UUID orderId) {
        Order order = orders.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown order " + orderId));
        order.cancel();
        orders.save(order);
        payments.refund(order.id().toString());
    }
}
`,D=i`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CancelOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public CancelOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    @Transactional
    public void cancel(UUID orderId) {
        Order order = orders.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown order " + orderId));
        order.cancel();
        orders.save(order);
        payments.refund(order.id().toString());
    }
}
`,O=i`
package com.shop.adapter.in.web;

import com.shop.application.PlaceOrderService;
import com.shop.domain.order.Order;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    private final PlaceOrderService placeOrder;
    private final OrderMapper mapper;

    public OrderController(PlaceOrderService placeOrder, OrderMapper mapper) {
        this.placeOrder = placeOrder;
        this.mapper = mapper;
    }

    @PostMapping("/orders")
    public OrderResponse create(@RequestBody OrderRequest request) {
        Order order = placeOrder.place(mapper.toDomain(request));
        return new OrderResponse(order.id(), order.getTotal().value(), order.status().name());
    }
}
`,k=O.replace(`order.getTotal()`,`order.totalAmount()`),A=i`
package com.shop.util;

public final class StringUtils {

    private StringUtils() {
    }

    public static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    public static String truncate(String s, int max) {
        if (s == null || s.length() <= max) return s;
        return s.substring(0, max - 1) + "…";
    }

    /**
     * @deprecated use {@link String#format} instead
     */
    @Deprecated
    public static String legacyPad(String s, int width) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < width) sb.append(' ');
        return sb.toString();
    }
}
`,j=i`
package com.shop.util;

public final class StringUtils {

    private StringUtils() {}

    public static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Truncates {@code s} to {@code max} characters, appending an ellipsis. */
    public static String truncate(String s, int max) {
        if (s == null || s.length() <= max) {
            return s;
        }
        return s.substring(0, max - 1) + "…";
    }
}
`,M=i`
package com.shop.util;

import com.shop.domain.money.Money;
import java.text.DecimalFormat;

@Deprecated
public class LegacyMoneyFormatter {

    private static final DecimalFormat FORMAT = new DecimalFormat("#,##0.00");

    public static String format(Money money) {
        return FORMAT.format(money.value()) + " " + money.currency().getSymbol();
    }
}
`,N=i`
package com.shop.adapter.out.report;

import java.util.List;
import java.time.LocalDate;
import com.shop.domain.order.Order;
import java.util.stream.Collectors;

public class ReportGenerator {

    public String dailyReport(LocalDate day, List<Order> orders) {
        String header = "Daily report " + day;
        String body = orders.stream().map(o -> o.id() + " " + o.status()).collect(Collectors.joining("\n"));
        return header + "\n" + body;
    }

    public int count(List<Order> orders){
        return orders.size();
    }
}
`,P=i`
package com.shop.adapter.out.report;

import com.shop.domain.order.Order;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

public class ReportGenerator {

    public String dailyReport(LocalDate day, List<Order> orders) {
        String header = "Daily report " + day;
        String body = orders.stream()
                .map(o -> o.id() + " " + o.status())
                .collect(Collectors.joining("\n"));
        return header + "\n" + body;
    }

    public int count(List<Order> orders) {
        return orders.size();
    }
}
`,F=i`
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.shop</groupId>
    <artifactId>shop</artifactId>
    <version>1.4.0-SNAPSHOT</version>

    <properties>
        <java.version>21</java.version>
        <stripe.version>24.3.0</stripe.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>com.stripe</groupId>
            <artifactId>stripe-java</artifactId>
            <version>${`$`}{stripe.version}</version>
        </dependency>
        <dependency>
            <groupId>com.iyzipay</groupId>
            <artifactId>iyzipay-java</artifactId>
            <version>2.0.131</version>
        </dependency>
    </dependencies>
</project>
`,I=F.replace(`24.3.0`,`26.1.0`).replace(`    </dependencies>`,[`        <dependency>`,`            <groupId>org.flywaydb</groupId>`,`            <artifactId>flyway-core</artifactId>`,`        </dependency>`,`    </dependencies>`].join(`
`)),L=i`
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/shop
  jpa:
    open-in-view: false

payment:
  provider: stripe
  stripe:
    timeout: 10s
`,R=i`
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/shop
  jpa:
    open-in-view: false
  flyway:
    enabled: true

payment:
  provider: stripe
  stripe:
    timeout: 30s
  idempotency:
    ttl: 24h
`,z=i`
ALTER TABLE orders ADD COLUMN payment_tx_id VARCHAR(64);
CREATE UNIQUE INDEX ux_orders_payment_tx ON orders (payment_tx_id);
`,B=i`
order.created=Siparişiniz alındı
order.cancelled=Siparişiniz iptal edildi
payment.failed=Ödeme başarısız
`,V=i`
order.created=Siparişiniz alındı
order.cancelled=Siparişiniz iptal edildi
payment.failed=Ödeme başarısız oldu, lütfen tekrar deneyin
payment.declined=Kartınız reddedildi
`,H=(e,t,n,r)=>i`
package com.shop.adapter.out.notification;

import com.shop.application.notification.AbstractNotifier;
import com.shop.domain.order.OrderEvent;
import org.springframework.stereotype.Component;

@Component
public class ${e} extends AbstractNotifier {

    private final ${n} client;

    public ${e}(${n} client) {
        this.client = client;
    }

    @Override
    protected String format(OrderEvent event) {
        return "[${t}] Order " + event.orderId() + " is " + event.type();
    }

    @Override
    protected void send(String recipient, String message) {
        ${r}
    }
}
`,U=H(`EmailNotifier`,`mail`,`MailClient`,`client.sendMail(recipient, "Order update", message);`),W=H(`SmsNotifier`,`sms`,`SmsClient`,`client.sendSms(recipient, message);`),G=H(`PushNotifier`,`push`,`PushClient`,`client.push(recipient, message);`),K=i`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import java.util.List;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {

    private final List<AbstractNotifier> notifiers;

    public OrderEventListener(List<AbstractNotifier> notifiers) {
        this.notifiers = notifiers;
    }

    @EventListener
    public void onOrderPlaced(OrderEvent event) {
        for (AbstractNotifier notifier : notifiers) {
            notifier.notify(event);
        }
    }
}
`,q=i`
package com.shop.adapter.out.report;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import com.shop.util.StringUtils;

public class InvoicePrinter {

    private static final int SKU_COLUMN = 18;

    public String print(Order order) {
        StringBuilder out = new StringBuilder("Invoice " + order.id() + "\n");
        for (OrderLine line : order.lines()) {
            out.append(StringUtils.legacyPad(line.sku(), SKU_COLUMN))
               .append(line.quantity())
               .append("\n");
        }
        return out.toString();
    }
}
`,J=i`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;
import org.springframework.stereotype.Service;

@Service
public class RefundService {

    private final PaymentGateway payments;

    public RefundService(PaymentGateway payments) {
        this.payments = payments;
    }

    /** Compensates a partially failed order by charging a negative amount. */
    public boolean compensate(Money amount, String customerId) {
        return payments.charge(amount.negate(), customerId);
    }
}
`,Y=i`
package com.shop.domain.money;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.Currency;
import org.junit.jupiter.api.Test;

class MoneyTest {

    private static final Currency TRY = Currency.getInstance("TRY");

    @Test
    void addsAmounts() {
        Money a = new Money(new BigDecimal("10.00"), TRY);
        assertThat(a.plus(a).value()).isEqualByComparingTo("20.00");
    }

    @Test
    void convertsToMinorUnits() {
        assertThat(new Money(new BigDecimal("12.34"), TRY).toMinorUnits()).isEqualTo(1234L);
    }
}
`,X=e({sampleFiles:()=>Z}),Z={[r.paymentGateway]:{old:a,new:o},[r.paymentResult]:{old:null,new:s},[r.paymentException]:{old:null,new:c},[r.stripe]:{old:l,new:u},[r.iyzico]:{old:d,new:f},[r.placeOrder]:{old:p,new:m},[r.orderValidator]:{old:null,new:h},[r.placeOrderTest]:{old:g,new:_},[r.order]:{old:v,new:y},[r.money]:{old:S,new:C},[r.notifier]:{old:w,new:T},[r.cancelOrder]:{old:E,new:D},[r.orderController]:{old:O,new:k},[r.stringUtils]:{old:A,new:j},[r.legacyFormatter]:{old:M,new:null},[r.reportGenerator]:{old:N,new:P},[r.pom]:{old:F,new:I},[r.appYml]:{old:L,new:R},[r.migration]:{old:null,new:z},[r.messages]:{old:B,new:V},[r.emailNotifier]:{old:U,new:U},[r.smsNotifier]:{old:W,new:W},[r.pushNotifier]:{old:G,new:G},[r.eventListener]:{old:K,new:K},[r.invoicePrinter]:{old:q,new:q},[r.refundService]:{old:J,new:J},[r.moneyTest]:{old:Y,new:Y}};Z[r.messagesOld]={old:B,new:null};export{X as n,r,Z as t};